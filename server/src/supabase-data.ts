import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  DeviceRecord,
  GatewayTrafficEvent,
  ProfileRecord,
  SessionRecord,
  TokenAuthenticator,
  UsageEventRecorder,
  UserDataService,
} from './contracts.js'
import type { ServerConfig } from './config.js'
import { ApiError, DatabaseOperationError } from './errors.js'

const authOptions = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
}

function throwDatabaseError(error: { code?: string; message: string }): never {
  throw new DatabaseOperationError(error.code, error.message)
}

function oneRow<T>(value: unknown): T {
  const row = Array.isArray(value) ? value[0] : value
  if (typeof row !== 'object' || row === null) {
    throw new ApiError(502, 'The data service returned an invalid response.', 'upstream_invalid_response')
  }
  return row as T
}

export class SupabaseUserDataService implements UserDataService {
  constructor(private readonly client: SupabaseClient) {}

  async getProfile(userId: string): Promise<ProfileRecord | null> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id,full_name,avatar_url,created_at,last_sign_in_at')
      .eq('id', userId)
      .maybeSingle()
    if (error) throwDatabaseError(error)
    return data
  }

  async listDevices(userId: string): Promise<DeviceRecord[]> {
    const { data, error } = await this.client
      .from('devices')
      .select('id,user_id,device_name,platform,status,created_at,last_seen_at,revoked_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) throwDatabaseError(error)
    return data
  }

  async registerDevice(
    deviceName: string,
    platform: DeviceRecord['platform'],
    idempotencyKey: string,
  ): Promise<DeviceRecord> {
    const { data, error } = await this.client.rpc('register_dataplus_device', {
      p_device_name: deviceName,
      p_platform: platform,
      p_registration_key: idempotencyKey,
    })
    if (error) throwDatabaseError(error)
    return oneRow<DeviceRecord>(data)
  }

  async revokeDevice(userId: string, deviceId: string): Promise<DeviceRecord> {
    const { data, error } = await this.client.rpc('revoke_dataplus_device', {
      p_device_id: deviceId,
    })
    if (error) throwDatabaseError(error)
    const device = oneRow<DeviceRecord>(data)
    if (device.user_id !== userId) {
      throw new ApiError(502, 'The data service returned an unexpected owner.', 'upstream_invalid_response')
    }
    return device
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    const { data, error } = await this.client
      .from('vpn_sessions')
      .select('id,user_id,device_id,status,reserved_bytes,consumed_bytes,remaining_bytes,created_at,started_at,stopped_at,gateway_verified_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throwDatabaseError(error)
    return data
  }

  async getSession(userId: string, sessionId: string): Promise<SessionRecord | null> {
    const { data, error } = await this.client
      .from('vpn_sessions')
      .select('id,user_id,device_id,status,reserved_bytes,consumed_bytes,remaining_bytes,created_at,started_at,stopped_at,gateway_verified_at')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throwDatabaseError(error)
    return data
  }

  async requestSession(deviceId: string, idempotencyKey: string): Promise<SessionRecord> {
    const { data, error } = await this.client.rpc('request_dataplus_session', {
      p_device_id: deviceId,
      p_idempotency_key: idempotencyKey,
    })
    if (error) throwDatabaseError(error)
    return oneRow<SessionRecord>(data)
  }

  async stopSession(userId: string, sessionId: string): Promise<SessionRecord | null> {
    const { data, error } = await this.client.rpc('request_dataplus_session_stop', {
      p_session_id: sessionId,
    })
    if (error) throwDatabaseError(error)
    const session = oneRow<SessionRecord>(data)
    if (session.user_id !== userId) {
      throw new ApiError(502, 'The data service returned an unexpected owner.', 'upstream_invalid_response')
    }
    return session
  }
}

export class SupabaseTokenAuthenticator implements TokenAuthenticator {
  constructor(
    private readonly config: ServerConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async authenticate(accessToken: string) {
    const authClient = createClient(this.config.supabaseUrl, this.config.supabaseAnonKey, {
      ...authOptions,
      global: { fetch: this.fetcher },
    })
    const { data, error } = await authClient.auth.getUser(accessToken)
    if (error) {
      const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined
      if (status === undefined || status >= 500) {
        throw new ApiError(503, 'Authentication service is unavailable.', 'auth_unavailable')
      }
      return null
    }
    if (!data.user) return null

    const client = createClient(this.config.supabaseUrl, this.config.supabaseAnonKey, {
      ...authOptions,
      global: {
        fetch: this.fetcher,
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    })
    return {
      user: { id: data.user.id, email: data.user.email },
      data: new SupabaseUserDataService(client),
    }
  }
}

export function createUsageEventRecorder(config: ServerConfig): UsageEventRecorder | undefined {
  if (!config.supabaseServiceRoleKey) return undefined

  const client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, authOptions)
  return {
    async record(event: GatewayTrafficEvent) {
      const { data, error } = await client.rpc('record_vpn_session_usage', {
        p_session_id: event.session_id,
        p_gateway_event_id: event.event_id,
        p_sequence: event.sequence,
        p_rx_bytes: event.rx_bytes,
        p_tx_bytes: event.tx_bytes,
      })
      if (error) throwDatabaseError(error)
      return String(data)
    },
  }
}
