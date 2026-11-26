import express, { type Request, type Response } from 'express'
import type { TokenAuthenticator } from '../contracts.js'
import type { UserDataService } from '../contracts.js'
import { requireUser } from '../auth-middleware.js'
import {
  getMe,
  getSession,
  listDevices,
  listSessions,
  registerDevice,
  requestSession,
  revokeDevice,
  stopSession,
} from '../controllers/api-controller.js'

const asyncRoute = (
  handler: (request: Request, response: Response) => Promise<void>,
) => (request: Request, response: Response, next: (error?: unknown) => void) => {
  void handler(request, response).catch(next)
}

export function createApiRouter(
  authenticator: TokenAuthenticator,
  beforeDeviceRevocation?: (userId: string, deviceId: string, data: UserDataService) => Promise<void>,
) {
  const router = express.Router()
  router.use(requireUser(authenticator))
  router.get('/me', asyncRoute(getMe))
  router.get('/devices', asyncRoute(listDevices))
  router.post('/devices', asyncRoute(registerDevice))
  router.post('/devices/:deviceId/revoke', asyncRoute((request, response) =>
    revokeDevice(request, response, beforeDeviceRevocation)))
  router.get('/sessions', asyncRoute(listSessions))
  router.post('/sessions', asyncRoute(requestSession))
  router.get('/sessions/:sessionId', asyncRoute(getSession))
  router.post('/sessions/:sessionId/stop', asyncRoute(stopSession))
  return router
}
