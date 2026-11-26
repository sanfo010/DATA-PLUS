import { ApiError } from './errors.js'
import type { GatewayTrafficEvent } from './contracts.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BIGINT_MAX = 9223372036854775807n
type DevicePlatform = 'web' | 'android' | 'ios' | 'unknown'

function isDevicePlatform(value: unknown): value is DevicePlatform {
  return value === 'web' || value === 'android' || value === 'ios' || value === 'unknown'
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function requireUuid(value: unknown, name: string): string {
  if (!isUuid(value)) throw new ApiError(400, `${name} must be a UUID.`, 'invalid_request')
  return value
}

export function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError(400, 'A JSON object is required.', 'invalid_request')
  }
  return value as Record<string, unknown>
}

export function rejectUnknownKeys(value: Record<string, unknown>, allowed: string[]): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unexpected.length > 0) {
    throw new ApiError(400, 'Request contains unsupported fields.', 'invalid_request')
  }
}

export function parseDeviceRegistration(value: unknown) {
  const body = requireObject(value)
  rejectUnknownKeys(body, ['device_name', 'platform', 'idempotency_key'])
  const deviceName = body.device_name
  const platform = body.platform
  if (typeof deviceName !== 'string' || deviceName.trim().length < 2 || deviceName.trim().length > 60) {
    throw new ApiError(400, 'device_name must contain 2 to 60 characters.', 'invalid_request')
  }
  if (!isDevicePlatform(platform)) {
    throw new ApiError(400, 'platform is unsupported.', 'invalid_request')
  }
  return {
    deviceName: deviceName.trim(),
    platform,
    idempotencyKey: requireUuid(body.idempotency_key, 'idempotency_key'),
  }
}

export function parseSessionRequest(value: unknown) {
  const body = requireObject(value)
  rejectUnknownKeys(body, ['device_id', 'idempotency_key'])
  return {
    deviceId: requireUuid(body.device_id, 'device_id'),
    idempotencyKey: requireUuid(body.idempotency_key, 'idempotency_key'),
  }
}

function requireBigintString(value: unknown, field: string, allowZero: boolean): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(value)) {
    throw new ApiError(400, `${field} must be a non-negative integer string.`, 'invalid_request')
  }
  const integer = BigInt(value)
  if (integer > BIGINT_MAX || (!allowZero && integer === 0n)) {
    throw new ApiError(400, `${field} is outside the supported range.`, 'invalid_request')
  }
  return value
}

export function parseTrafficEvent(value: unknown): GatewayTrafficEvent {
  const body = requireObject(value)
  rejectUnknownKeys(body, ['event_id', 'session_id', 'sequence', 'rx_bytes', 'tx_bytes'])
  return {
    event_id: requireUuid(body.event_id, 'event_id'),
    session_id: requireUuid(body.session_id, 'session_id'),
    sequence: requireBigintString(body.sequence, 'sequence', false),
    rx_bytes: requireBigintString(body.rx_bytes, 'rx_bytes', true),
    tx_bytes: requireBigintString(body.tx_bytes, 'tx_bytes', true),
  }
}
