export type LabSessionStatus =
  | 'requested'
  | 'authorized'
  | 'connecting'
  | 'connected'
  | 'interrupted'
  | 'stopping'
  | 'stopped'
  | 'failed'

export type WireGuardDevicePeer = {
  id: string
  user_id: string
  device_id: string
  key_version: number
  public_key: string
  assigned_ip: string
  status: 'active' | 'revoked'
  created_at: string
  revoked_at: string | null
}

export type PersistentLabSession = {
  id: string
  user_id: string
  device_id: string
  peer_id: string | null
  gateway_mode: 'shared_lab' | 'device_peer'
  idempotency_key: string
  status: LabSessionStatus
  baseline_rx_bytes: string
  baseline_tx_bytes: string
  rx_bytes: string
  tx_bytes: string
  last_handshake_at: string | null
  last_observed_at: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  stopped_at: string | null
}

export type NewWireGuardDevicePeer = Omit<WireGuardDevicePeer, 'created_at' | 'revoked_at'>

export interface LabRepository {
  createPeer(peer: NewWireGuardDevicePeer): Promise<WireGuardDevicePeer>
  getPeer(userId: string, deviceId: string): Promise<WireGuardDevicePeer | null>
  listPeers(userId: string): Promise<WireGuardDevicePeer[]>
  revokePeer(userId: string, deviceId: string): Promise<WireGuardDevicePeer | null>
  findLabSessionByIdempotency(userId: string, key: string): Promise<PersistentLabSession | null>
  getLabSession(userId: string, sessionId: string): Promise<PersistentLabSession | null>
  createLabSession(session: PersistentLabSession): Promise<void>
  updateLabSession(session: PersistentLabSession): Promise<void>
  getOpenLabSessions(gatewayMode: PersistentLabSession['gateway_mode']): Promise<PersistentLabSession[]>
}
