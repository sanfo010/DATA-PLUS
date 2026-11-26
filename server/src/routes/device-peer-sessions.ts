import express, { type Request, type Response } from 'express'
import type { TokenAuthenticator } from '../contracts.js'
import { requireUser } from '../auth-middleware.js'
import { DevicePeerSessionManager } from '../device-peer-sessions.js'
import { ApiError } from '../errors.js'

const asyncRoute = (
  handler: (request: Request, response: Response) => Promise<void>,
) => (request: Request, response: Response, next: (error?: unknown) => void) => {
  void handler(request, response).catch(next)
}

export function createDevicePeerSessionRouter(
  authenticator: TokenAuthenticator,
  manager: DevicePeerSessionManager,
) {
  const router = express.Router()
  router.use(requireUser(authenticator))

  router.post('/', asyncRoute(async (request, response) => {
    response.status(201).json({
      data: await manager.start(
        request.authContext!.user.id,
        request.authContext!.data,
        request.body,
      ),
    })
  }))

  router.get('/:sessionId', asyncRoute(async (request, response) => {
    const sessionId = request.params.sessionId
    if (typeof sessionId !== 'string') throw new ApiError(400, 'Invalid session id.', 'invalid_request')
    response.json({
      data: await manager.get(request.authContext!.user.id, sessionId),
    })
  }))

  router.post('/:sessionId/stop', asyncRoute(async (request, response) => {
    const sessionId = request.params.sessionId
    if (typeof sessionId !== 'string') throw new ApiError(400, 'Invalid session id.', 'invalid_request')
    if (
      typeof request.body !== 'object'
      || request.body === null
      || Array.isArray(request.body)
      || Object.keys(request.body).length > 0
    ) {
      throw new ApiError(400, 'Stop request body must be an empty object.', 'invalid_request')
    }
    response.json({
      data: await manager.stop(request.authContext!.user.id, sessionId),
    })
  }))

  return router
}
