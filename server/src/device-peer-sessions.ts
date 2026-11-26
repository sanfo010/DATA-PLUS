import { randomUUID } from 'node:crypto'
import type { UserDataService } from './contracts.js'
import { ApiError, notFound } from './errors.js'
import type { DeviceWireGuardGateway } from './gateway-wsl-devices.js'
import type {
  LabRepository,
  LabSessionStatus,
  PersistentLabSession,
} from './lab-contracts.js'

export type DevicePeerSession = Pick<
  PersistentLabSession,
  | 'id'
  | 'user_id'
  | 'device_id'
  | 'peer_id'
  | 'gateway_mode'
  | 'status'
  | 'rx_bytes'
  | 'tx_bytes'
  | 'last_handshake_at'
  | 'last_observed_at'
  | 'created_at'
  | 'updated_at'
  | 'started_at'
  | 'stopped_at'
>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const handshakeFreshnessMs = 180_000

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new ApiError(400, `${field} must be a UUID.`, 'invalid_request')
  }
}

function freshHandshake(session: PersistentLabSession, handshakeAt: string | null): boolean {
  if (!handshakeAt) return false
  const timestamp = Date.parse(handshakeAt)
  const createdAt = Date.parse(session.created_at)
  const age = Date.now() - timestamp
  return Number.isFinite(timestamp)
    && timestamp >= createdAt
    && age >= -30_000
    && age <= handshakeFreshnessMs
}

export class DevicePeerSessionManager {
  private readonly initialized: Promise<void>
  private operation: Promise<void> = Promise.resolve()

  constructor(
    private readonly gateway: DeviceWireGuardGateway,
    private readonly repository: LabRepository,
  ) {
    this.initialized = this.restoreSessions()
  }

  async start(userId: string, data: UserDataService, input: unknown): Promise<DevicePeerSession> {
    await this.initialized
    const body = this.validateStartBody(input)
    return this.exclusive(async () => {
      const previous = await this.repository.findLabSessionByIdempotency(
        userId,
        body.idempotency_key,
      )
      if (previous) {
        if (previous.device_id !== body.device_id || previous.gateway_mode !== 'device_peer') {
          throw new ApiError(409, 'Idempotency key was already used for another session.', 'conflict')
        }
        return this.toPublicSession(await this.refresh(previous))
      }

      const device = (await data.listDevices(userId)).find(
        (item) => item.id === body.device_id && item.status === 'active',
      )
      if (!device) throw notFound('Active account device not found.')
      const peer = await this.repository.getPeer(userId, body.device_id)
      if (!peer || peer.status !== 'active') throw notFound('Active WireGuard peer not found for this device.')

      const sharedLabSessions = await this.repository.getOpenLabSessions('shared_lab')
      if (sharedLabSessions.some((session) => session.device_id === body.device_id)) {
        throw new ApiError(409, 'This device already has an open WireGuard session.', 'device_session_busy')
      }

      const openSessions = await this.repository.getOpenLabSessions('device_peer')
      const existing = openSessions.find((session) => session.device_id === body.device_id)
      if (existing) {
        if (existing.user_id !== userId || existing.peer_id !== peer.id) {
          throw new ApiError(409, 'This device already has an incompatible open session.', 'device_session_busy')
        }
        return this.toPublicSession(await this.refresh(existing))
      }

      const observed = await this.gateway.getDeviceStatus(body.device_id)
      if (
        !observed
        || observed.status !== 'active'
        || !observed.interfaceLoaded
        || observed.publicKey !== peer.public_key
      ) {
        throw new ApiError(503, 'The enrolled WireGuard peer is not available at the gateway.', 'device_peer_unavailable')
      }

      const now = new Date().toISOString()
      const session: PersistentLabSession = {
        id: randomUUID(),
        user_id: userId,
        device_id: body.device_id,
        peer_id: peer.id,
        gateway_mode: 'device_peer',
        idempotency_key: body.idempotency_key,
        status: 'connecting',
        baseline_rx_bytes: observed.rxBytes ?? '0',
        baseline_tx_bytes: observed.txBytes ?? '0',
        rx_bytes: '0',
        tx_bytes: '0',
        last_handshake_at: null,
        last_observed_at: now,
        created_at: now,
        updated_at: now,
        started_at: null,
        stopped_at: null,
      }
      await this.repository.createLabSession(session)
      return this.toPublicSession(session)
    })
  }

  async get(userId: string, sessionId: string): Promise<DevicePeerSession> {
    await this.initialized
    assertUuid(sessionId, 'sessionId')
    return this.exclusive(async () => {
      const session = await this.requireOwnedSession(userId, sessionId)
      return this.toPublicSession(await this.refresh(session))
    })
  }

  async stop(userId: string, sessionId: string): Promise<DevicePeerSession> {
    await this.initialized
    assertUuid(sessionId, 'sessionId')
    return this.exclusive(async () => {
      const session = await this.requireOwnedSession(userId, sessionId)
      if (session.status === 'stopped') return this.toPublicSession(session)
      const now = new Date().toISOString()
      const observed = await this.gateway.getDeviceStatus(session.device_id)
      const stopping = Boolean(
        observed
        && observed.status === 'active'
        && observed.publicKey === (await this.repository.getPeer(userId, session.device_id))?.public_key
        && freshHandshake(session, observed.handshakeAt),
      )
      const stopped = {
        ...session,
        status: stopping ? 'stopping' as const : 'stopped' as const,
        stopped_at: stopping ? null : now,
        updated_at: now,
      }
      await this.repository.updateLabSession(stopped)
      return this.toPublicSession(stopped)
    })
  }

  async stopForDevice(userId: string, deviceId: string): Promise<void> {
    await this.initialized
    await this.exclusive(async () => {
      const sessions = await this.repository.getOpenLabSessions('device_peer')
      const now = new Date().toISOString()
      for (const session of sessions) {
        if (session.user_id !== userId || session.device_id !== deviceId) continue
        await this.repository.updateLabSession({
          ...session,
          status: 'stopped',
          stopped_at: now,
          updated_at: now,
        })
      }
    })
  }

  private async restoreSessions(): Promise<void> {
    const sessions = await this.repository.getOpenLabSessions('device_peer')
    for (const session of sessions) {
      const restored = await this.refresh(session)
      if (restored.status === 'connecting') {
        await this.repository.updateLabSession({
          ...restored,
          status: 'interrupted',
          updated_at: new Date().toISOString(),
        })
      }
    }
  }

  private async refresh(session: PersistentLabSession): Promise<PersistentLabSession> {
    if (session.status === 'stopped' || session.status === 'failed') return session
    const now = new Date().toISOString()
    let status: LabSessionStatus = 'interrupted'
    let handshakeAt: string | null = session.last_handshake_at
    let rxBytes = session.rx_bytes
    let txBytes = session.tx_bytes
    try {
      const [peer, observed] = await Promise.all([
        this.repository.getPeer(session.user_id, session.device_id),
        this.gateway.getDeviceStatus(session.device_id),
      ])
      if (
        peer
        && peer.id === session.peer_id
        && peer.status === 'active'
        && observed
        && observed.status === 'active'
        && observed.interfaceLoaded
        && observed.publicKey === peer.public_key
      ) {
        handshakeAt = observed.handshakeAt
        if (freshHandshake(session, handshakeAt)) {
          status = session.status === 'stopping' ? 'stopping' : 'connected'
          rxBytes = this.delta(session.baseline_rx_bytes, session.rx_bytes, observed.rxBytes)
          txBytes = this.delta(session.baseline_tx_bytes, session.tx_bytes, observed.txBytes)
        } else if (session.status === 'stopping') {
          status = 'stopped'
        } else if (
          session.status === 'connecting'
          && !session.last_handshake_at
          && Date.now() - Date.parse(session.created_at) < 30_000
        ) {
          status = 'connecting'
        }
      }
    } catch {
      status = 'interrupted'
    }
    const updated = {
      ...session,
      status,
      rx_bytes: rxBytes,
      tx_bytes: txBytes,
      last_handshake_at: handshakeAt,
      last_observed_at: now,
      updated_at: now,
      started_at: status === 'connected' ? session.started_at ?? handshakeAt : session.started_at,
      stopped_at: status === 'stopped' ? session.stopped_at ?? now : null,
    }
    await this.repository.updateLabSession(updated)
    return updated
  }

  private delta(baseline: string, previous: string, observed: string | null): string {
    if (!observed || !/^(0|[1-9]\d{0,19})$/.test(observed)) return previous
    const value = BigInt(observed) - BigInt(baseline)
    return (value > 0n ? value : 0n).toString()
  }

  private async requireOwnedSession(userId: string, sessionId: string): Promise<PersistentLabSession> {
    const session = await this.repository.getLabSession(userId, sessionId)
    if (!session || session.gateway_mode !== 'device_peer') throw notFound('Device-peer session not found.')
    return session
  }

  private validateStartBody(input: unknown): { device_id: string; idempotency_key: string } {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new ApiError(400, 'Request body must be an object.', 'invalid_request')
    }
    const body = input as Record<string, unknown>
    if (Object.keys(body).some((key) => key !== 'device_id' && key !== 'idempotency_key')) {
      throw new ApiError(400, 'Request body contains unsupported fields.', 'invalid_request')
    }
    assertUuid(body.device_id, 'device_id')
    assertUuid(body.idempotency_key, 'idempotency_key')
    return { device_id: body.device_id, idempotency_key: body.idempotency_key }
  }

  private async exclusive<T>(callback: () => Promise<T>): Promise<T> {
    const previous = this.operation
    let release!: () => void
    this.operation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await callback()
    } finally {
      release()
    }
  }

  private toPublicSession(session: PersistentLabSession): DevicePeerSession {
    return {
      id: session.id,
      user_id: session.user_id,
      device_id: session.device_id,
      peer_id: session.peer_id,
      gateway_mode: session.gateway_mode,
      status: session.status,
      rx_bytes: session.rx_bytes,
      tx_bytes: session.tx_bytes,
      last_handshake_at: session.last_handshake_at,
      last_observed_at: session.last_observed_at,
      created_at: session.created_at,
      updated_at: session.updated_at,
      started_at: session.started_at,
      stopped_at: session.stopped_at,
    }
  }
}
