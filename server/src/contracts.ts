export type AuthenticatedUser = {
  id: string
  email: string | undefined
}

export type ProfileRecord = {
  id: string
  full_name: string
  avatar_url: string | null
  created_at: string
  last_sign_in_at: string | null
}

export type DeviceRecord = {
  id: string
  user_id: string
  device_name: string
  platform: 'web' | 'android' | 'ios' | 'unknown'
  status: 'active' | 'inactive' | 'revoked'
  created_at: string
  last_seen_at: string | null
  revoked_at: string | null
}

export type SessionRecord = {
  id: string
  user_id: string
  device_id: string
  status: 'requested' | 'authorized' | 'connecting' | 'connected' | 'interrupted' | 'stopping' | 'stopped' | 'failed'
  reserved_bytes: number
  consumed_bytes: number
  remaining_bytes: number
  created_at: string
  started_at: string | null
  stopped_at: string | null
  gateway_verified_at: string | null
}

export interface UserDataService {
  getProfile(userId: string): Promise<ProfileRecord | null>
  listDevices(userId: string): Promise<DeviceRecord[]>
  registerDevice(deviceName: string, platform: DeviceRecord['platform'], idempotencyKey: string): Promise<DeviceRecord>
  revokeDevice(userId: string, deviceId: string): Promise<DeviceRecord>
  listSessions(userId: string): Promise<SessionRecord[]>
  getSession(userId: string, sessionId: string): Promise<SessionRecord | null>
  requestSession(deviceId: string, idempotencyKey: string): Promise<SessionRecord>
  stopSession(userId: string, sessionId: string): Promise<SessionRecord | null>
}

export type AuthenticatedContext = {
  user: AuthenticatedUser
  data: UserDataService
}

export interface TokenAuthenticator {
  authenticate(accessToken: string): Promise<AuthenticatedContext | null>
}

export type GatewayTrafficEvent = {
  event_id: string
  session_id: string
  sequence: string
  rx_bytes: string
  tx_bytes: string
}

export interface UsageEventRecorder {
  record(event: GatewayTrafficEvent): Promise<string>
}
