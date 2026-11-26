import { randomUUID } from 'node:crypto'
import cors from 'cors'
import express, { type ErrorRequestHandler } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import type { ServerConfig } from './config.js'
import type { TokenAuthenticator, UsageEventRecorder } from './contracts.js'
import { ApiError, notFound, toApiError } from './errors.js'
import type { WireGuardGateway } from './gateway.js'
import { createGatewayWebhookHandler } from './gateway-webhook.js'
import { LocalWslWireGuardGateway } from './gateway-local-wsl.js'
import { LocalWslDeviceGateway, type DeviceWireGuardGateway } from './gateway-wsl-devices.js'
import { DevicePeerManager } from './device-peers.js'
import { DevicePeerSessionManager } from './device-peer-sessions.js'
import type { LabRepository } from './lab-contracts.js'
import { SupabaseLabRepository } from './lab-repository.js'
import { LabSessionManager } from './lab-sessions.js'
import { createApiRouter } from './routes/api.js'
import { createDevicePeerRouter } from './routes/device-peers.js'
import { createDevicePeerSessionRouter } from './routes/device-peer-sessions.js'
import { createLabRouter } from './routes/lab.js'
import { SupabaseTokenAuthenticator, createUsageEventRecorder } from './supabase-data.js'

type AppDependencies = {
  authenticator?: TokenAuthenticator
  usageEventRecorder?: UsageEventRecorder
  gateway?: WireGuardGateway
  deviceGateway?: DeviceWireGuardGateway
  labRepository?: LabRepository
}

export function createApp(config: ServerConfig, dependencies: AppDependencies = {}) {
  const app = express()
  const authenticator = dependencies.authenticator ?? new SupabaseTokenAuthenticator(config)
  const usageEventRecorder = dependencies.usageEventRecorder ?? createUsageEventRecorder(config)
  const gateway = dependencies.gateway ?? (config.wireGuardLabEnabled
    ? new LocalWslWireGuardGateway()
    : undefined)
  const repository = dependencies.labRepository ?? (
    config.wireGuardDevicesEnabled || config.wireGuardSessionPersistenceEnabled
      ? new SupabaseLabRepository(config)
      : undefined
  )
  const deviceGateway = dependencies.deviceGateway ?? (config.wireGuardDevicesEnabled
    ? new LocalWslDeviceGateway()
    : undefined)
  const devicePeers = deviceGateway && repository
    ? new DevicePeerManager(deviceGateway, repository, config.wireGuardDeviceEndpoint)
    : undefined
  const devicePeerSessions = devicePeers && deviceGateway && repository
      && config.wireGuardSessionPersistenceEnabled
    ? new DevicePeerSessionManager(deviceGateway, repository)
    : undefined
  const labSessions = gateway
    ? new LabSessionManager(
      gateway,
      config.wireGuardSessionPersistenceEnabled ? repository : undefined,
    )
    : undefined

  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new ApiError(403, 'Origin is not allowed.', 'origin_not_allowed'))
      }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-DataPlus-Timestamp', 'X-DataPlus-Signature'],
    maxAge: 600,
  }))
  app.use((request, response, next) => {
    request.requestId = randomUUID()
    const started = Date.now()
    response.on('finish', () => {
      console.info(JSON.stringify({
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Date.now() - started,
      }))
    })
    next()
  })
  app.use(express.json({
    limit: '32kb',
    verify(request, _response, buffer) {
      request.rawBody = Buffer.from(buffer)
    },
  }))

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  })
  app.use('/api/v1', apiLimiter)
  app.use('/internal/v1', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }))

  app.get('/health', (_request, response) => {
    response.json({ data: { status: 'ok' } })
  })
  app.get('/api/v1/capabilities', (_request, response) => {
    response.json({
      data: {
        gateway: gateway ? 'local_wsl_lab' : 'unconfigured',
        labSessions: gateway ? 'enabled' : 'disabled',
        devicePeers: devicePeers ? 'enabled' : 'disabled',
        labSessionPersistence: config.wireGuardSessionPersistenceEnabled ? 'enabled' : 'disabled',
        trafficMetering: 'gateway_events_only',
        walletMutations: false,
      },
    })
  })

  app.use('/api/v1', createApiRouter(authenticator, async (userId, deviceId, data) => {
    await labSessions?.revokeDevice(userId, deviceId)
    await devicePeers?.revokeOnDeviceRemoval(userId, data, deviceId)
    await devicePeerSessions?.stopForDevice(userId, deviceId)
  }))
  if (devicePeers) {
    app.use('/api/v1/devices', createDevicePeerRouter(authenticator, devicePeers))
  }
  if (devicePeerSessions) {
    app.use(
      '/api/v1/device-peer-sessions',
      createDevicePeerSessionRouter(authenticator, devicePeerSessions),
    )
  }
  if (labSessions) app.use('/api/v1/lab', createLabRouter(authenticator, labSessions))
  app.post('/internal/v1/gateway/events', createGatewayWebhookHandler(config, usageEventRecorder))

  app.use((_request, _response, next) => next(notFound('Route not found.')))

  const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
    const apiError = toApiError(error)
    if (apiError.status >= 500) {
      console.error(JSON.stringify({
        requestId: request.requestId,
        code: apiError.code,
        message: apiError.message,
      }))
    }
    response.status(apiError.status).json({
      error: {
        code: apiError.code,
        message: apiError.message,
        request_id: request.requestId,
      },
    })
  }
  app.use(errorHandler)

  return app
}
