import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { ServerConfig } from './config.js'
import type { UsageEventRecorder } from './contracts.js'
import { ApiError, unavailable } from './errors.js'
import { parseTrafficEvent } from './validation.js'

const MAX_CLOCK_SKEW_SECONDS = 300

export function createGatewayWebhookHandler(
  config: ServerConfig,
  recorder: UsageEventRecorder | undefined,
) {
  return async (request: Request, response: Response, next: NextFunction) => {
    if (!config.gatewayWebhookSecret || !recorder) {
      next(unavailable('Gateway event intake is not configured.'))
      return
    }

    const timestamp = request.header('x-dataplus-timestamp')
    const signature = request.header('x-dataplus-signature')
    if (!timestamp || !/^\d{10}$/.test(timestamp) || !signature || !/^v1=[0-9a-f]{64}$/i.test(signature)) {
      next(new ApiError(401, 'Invalid gateway signature.', 'invalid_gateway_signature'))
      return
    }

    const timestampSeconds = Number(timestamp)
    if (Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) {
      next(new ApiError(401, 'Gateway event timestamp is outside the accepted window.', 'stale_gateway_event'))
      return
    }
    if (!request.rawBody) {
      next(new ApiError(400, 'A JSON request body is required.', 'invalid_request'))
      return
    }

    const expected = createHmac('sha256', config.gatewayWebhookSecret)
      .update(timestamp)
      .update('.')
      .update(request.rawBody)
      .digest()
    const supplied = Buffer.from(signature.slice(3), 'hex')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      next(new ApiError(401, 'Invalid gateway signature.', 'invalid_gateway_signature'))
      return
    }

    try {
      const event = parseTrafficEvent(request.body)
      const deltaBytes = await recorder.record(event)
      response.status(202).json({ data: { accepted: true, delta_bytes: deltaBytes } })
    } catch (error) {
      next(error)
    }
  }
}
