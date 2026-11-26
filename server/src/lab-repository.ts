import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ServerConfig } from './config.js'
import type {
  LabRepository,
  NewWireGuardDevicePeer,
  PersistentLabSession,
  WireGuardDevicePeer,
} from './lab-contracts.js'
import { ApiError, DatabaseOperationError } from './errors.js'

const serviceAuth = {
  autoRefreshToken: false,
  detectSessionInUrl: false,
  persistSession: false,
}

const PEER_COLUMNS = 'id,user_id,device_id,key_version,public_key,assigned_ip,status,created_at,revoked_at'
const SESSION_COLUMNS = 'id,user_id,device_id,peer_id,gateway_mode,idempotency_key,status,baseline_rx_bytes,baseline_tx_bytes,rx_bytes,tx_bytes,last_handshake_at,last_observed_at,created_at,updated_at,started_at,stopped_at'
const OPEN_STATUSES = ['requested', 'authorized', 'connecting', 'connected', 'interrupted', 'stopping']

function raiseDatabaseError(error: { code?: string; message: string }): never {
  throw new DatabaseOperationError(error.code, error.message)
}

function parseRow<T>(value: unknown): T {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError(502, 'The lab data service returned an invalid response.', 'upstream_invalid_response')
  }
  return value as T
}

export class SupabaseLabRepository implements LabRepository {
  private readonly client: SupabaseClient

  constructor(config: ServerConfig) {
    if (!config.supabaseServiceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for persistent WireGuard lab data.')
    }
    this.client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: serviceAuth,
    })
  }

  async createPeer(peer: NewWireGuardDevicePeer): Promise<WireGuardDevicePeer> {
    const { data, error } = await this.client
      .from('wireguard_device_peers')
      .insert(peer)
      .select(PEER_COLUMNS)
      .single()
    if (error) raiseDatabaseError(error)
    return parseRow<WireGuardDevicePeer>(data)
  }

  async getPeer(userId: string, deviceId: string): Promise<WireGuardDevicePeer | null> {
    const { data, error } = await this.client
      .from('wireguard_device_peers')
      .select(PEER_COLUMNS)
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .order('key_version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) raiseDatabaseError(error)
    return data
  }

  async listPeers(userId: string): Promise<WireGuardDevicePeer[]> {
    const { data, error } = await this.client
      .from('wireguard_device_peers')
      .select(PEER_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) raiseDatabaseError(error)
    return data
  }

  async revokePeer(userId: string, deviceId: string): Promise<WireGuardDevicePeer | null> {
    const { data, error } = await this.client
      .from('wireguard_device_peers')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .eq('status', 'active')
      .select(PEER_COLUMNS)
      .maybeSingle()
    if (error) raiseDatabaseError(error)
    return data
  }

  async findLabSessionByIdempotency(
    userId: string,
    key: string,
  ): Promise<PersistentLabSession | null> {
    const { data, error } = await this.client
      .from('vpn_lab_sessions')
      .select(SESSION_COLUMNS)
      .eq('user_id', userId)
      .eq('idempotency_key', key)
      .maybeSingle()
    if (error) raiseDatabaseError(error)
    return data
  }

  async createLabSession(session: PersistentLabSession): Promise<void> {
    const { error } = await this.client.from('vpn_lab_sessions').insert(session)
    if (error) raiseDatabaseError(error)
  }

  async getLabSession(userId: string, sessionId: string): Promise<PersistentLabSession | null> {
    const { data, error } = await this.client
      .from('vpn_lab_sessions')
      .select(SESSION_COLUMNS)
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) raiseDatabaseError(error)
    return data
  }

  async updateLabSession(session: PersistentLabSession): Promise<void> {
    const { error } = await this.client
      .from('vpn_lab_sessions')
      .update({
        status: session.status,
        baseline_rx_bytes: session.baseline_rx_bytes,
        baseline_tx_bytes: session.baseline_tx_bytes,
        rx_bytes: session.rx_bytes,
        tx_bytes: session.tx_bytes,
        last_handshake_at: session.last_handshake_at,
        last_observed_at: session.last_observed_at,
        updated_at: session.updated_at,
        started_at: session.started_at,
        stopped_at: session.stopped_at,
      })
      .eq('id', session.id)
      .eq('user_id', session.user_id)
    if (error) raiseDatabaseError(error)
  }

  async getOpenLabSessions(
    gatewayMode: PersistentLabSession['gateway_mode'],
  ): Promise<PersistentLabSession[]> {
    const { data, error } = await this.client
      .from('vpn_lab_sessions')
      .select(SESSION_COLUMNS)
      .eq('gateway_mode', gatewayMode)
      .in('status', OPEN_STATUSES)
      .order('created_at', { ascending: true })
    if (error) raiseDatabaseError(error)
    return data
  }
}
