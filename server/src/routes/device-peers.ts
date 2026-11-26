import express, { type Request, type Response } from 'express'
import type { TokenAuthenticator } from '../contracts.js'
import { requireUser } from '../auth-middleware.js'
import { DevicePeerManager } from '../device-peers.js'
import { ApiError } from '../errors.js'
import { requireUuid, rejectUnknownKeys, requireObject } from '../validation.js'

const asyncRoute = (
  handler: (request: Request, response: Response) => Promise<void>,
) => (request: Request, response: Response, next: (error?: unknown) => void) => {
  void handler(request, response).catch(next)
}

export function createDevicePeerRouter(
  authenticator: TokenAuthenticator,
  manager: DevicePeerManager,
) {
  const router = express.Router()
  router.use(requireUser(authenticator))

  router.get('/wireguard', asyncRoute(async (request, response) => {
    response.json({ data: await manager.list(request.authContext!.user.id) })
  }))

  router.get('/:deviceId/wireguard', asyncRoute(async (request, response) => {
    const deviceId = requireUuid(request.params.deviceId, 'deviceId')
    const context = request.authContext!
    response.json({ data: await manager.get(context.user.id, context.data, deviceId) })
  }))

  router.post('/:deviceId/wireguard', asyncRoute(async (request, response) => {
    const deviceId = requireUuid(request.params.deviceId, 'deviceId')
    const context = request.authContext!
    const body = requireObject(request.body)
    rejectUnknownKeys(body, ['public_key'])
    if (typeof body.public_key !== 'string') {
      throw new ApiError(400, 'public_key is required.', 'invalid_request')
    }
    response.status(201).json({
      data: await manager.enroll(context.user.id, context.data, deviceId, body.public_key),
    })
  }))

  router.post('/:deviceId/wireguard/revoke', asyncRoute(async (request, response) => {
    rejectUnknownKeys(requireObject(request.body), [])
    const deviceId = requireUuid(request.params.deviceId, 'deviceId')
    const context = request.authContext!
    response.json({
      data: await manager.revoke(context.user.id, context.data, deviceId),
    })
  }))

  router.get('/:deviceId/wireguard/configuration', asyncRoute(async (request, response) => {
    const deviceId = requireUuid(request.params.deviceId, 'deviceId')
    const context = request.authContext!
    response.json({
      data: await manager.getConfiguration(context.user.id, context.data, deviceId),
    })
  }))

  return router
}
