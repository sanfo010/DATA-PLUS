import type { Request, Response } from 'express'
import type { UserDataService } from '../contracts.js'
import { notFound } from '../errors.js'
import {
  parseDeviceRegistration,
  parseSessionRequest,
  rejectUnknownKeys,
  requireObject,
  requireUuid,
} from '../validation.js'

export async function getMe(request: Request, response: Response): Promise<void> {
  const context = request.authContext!
  const profile = await context.data.getProfile(context.user.id)
  response.json({
    data: {
      id: context.user.id,
      email: context.user.email,
      profile,
    },
  })
}

export async function listDevices(request: Request, response: Response): Promise<void> {
  const context = request.authContext!
  response.json({ data: await context.data.listDevices(context.user.id) })
}

export async function registerDevice(request: Request, response: Response): Promise<void> {
  const context = request.authContext!
  const input = parseDeviceRegistration(request.body)
  const device = await context.data.registerDevice(
    input.deviceName,
    input.platform,
    input.idempotencyKey,
  )
  response.status(201).json({ data: device })
}

export async function revokeDevice(
  request: Request,
  response: Response,
  beforeRevoke?: (userId: string, deviceId: string, data: UserDataService) => Promise<void>,
): Promise<void> {
  const context = request.authContext!
  rejectUnknownKeys(requireObject(request.body), [])
  const deviceId = requireUuid(request.params.deviceId, 'deviceId')
  await beforeRevoke?.(context.user.id, deviceId, context.data)
  response.json({ data: await context.data.revokeDevice(context.user.id, deviceId) })
}

export async function listSessions(request: Request, response: Response): Promise<void> {
  const context = request.authContext!
  response.json({ data: await context.data.listSessions(context.user.id) })
}

export async function requestSession(request: Request, response: Response): Promise<void> {
  const context = request.authContext!
  const input = parseSessionRequest(request.body)
  const session = await context.data.requestSession(input.deviceId, input.idempotencyKey)
  response.status(201).json({ data: session })
}

export async function getSession(request: Request, response: Response): Promise<void> {
  const context = request.authContext!
  const sessionId = requireUuid(request.params.sessionId, 'sessionId')
  const session = await context.data.getSession(context.user.id, sessionId)
  if (!session) throw notFound('Session not found.')
  response.json({ data: session })
}

export async function stopSession(request: Request, response: Response): Promise<void> {
  const context = request.authContext!
  rejectUnknownKeys(requireObject(request.body), [])
  const sessionId = requireUuid(request.params.sessionId, 'sessionId')
  const session = await context.data.stopSession(context.user.id, sessionId)
  if (!session) throw notFound('Session not found.')
  response.json({ data: session })
}
