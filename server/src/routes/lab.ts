import express, { type Request, type Response } from 'express'
import type { TokenAuthenticator } from '../contracts.js'
import { requireUser } from '../auth-middleware.js'
import { LabSessionManager } from '../lab-sessions.js'
import { ApiError } from '../errors.js'

const asyncRoute = (
  handler: (request: Request, response: Response) => Promise<void>,
) => (request: Request, response: Response, next: (error?: unknown) => void) => {
  void handler(request, response).catch(next)
}

export function createLabRouter(authenticator: TokenAuthenticator, manager: LabSessionManager) {
  const router = express.Router()
  router.use(requireUser(authenticator))

  router.get('/gateway', asyncRoute(async (_request, response) => {
    response.json({ data: await manager.checkGateway() })
  }))

  router.post('/sessions', asyncRoute(async (request, response) => {
    const context = request.authContext!
    const session = await manager.start(context.user.id, context.data, request.body)
    response.status(201).json({ data: session })
  }))

  router.get('/sessions/current', asyncRoute(async (request, response) => {
    const session = await manager.current(request.authContext!.user.id)
    response.json({ data: session })
  }))

  router.post('/sessions/reconcile', asyncRoute(async (request, response) => {
    if (
      typeof request.body !== 'object'
      || request.body === null
      || Array.isArray(request.body)
      || Object.keys(request.body).length > 0
    ) {
      throw new ApiError(400, 'Reconciliation request body must be an empty object.', 'invalid_request')
    }
    const sessions = await manager.reconcile(request.authContext!.user.id)
    response.json({ data: sessions })
  }))

  router.get('/sessions/:sessionId', asyncRoute(async (request, response) => {
    const sessionId = request.params.sessionId
    if (typeof sessionId !== 'string') throw new ApiError(400, 'Invalid session id.', 'invalid_request')
    const session = await manager.get(request.authContext!.user.id, sessionId)
    response.json({ data: session })
  }))

  router.post('/sessions/:sessionId/stop', asyncRoute(async (request, response) => {
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
    const session = await manager.stop(request.authContext!.user.id, sessionId)
    response.json({ data: session })
  }))

  return router
}
