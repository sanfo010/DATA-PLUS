import { randomUUID } from 'node:crypto'
import type { UserDataService } from './contracts.js'
import type { GatewayObservation, WireGuardGateway } from './gateway.js'
import { ApiError, notFound } from './errors.js'
import type { LabRepository, LabSessionStatus, PersistentLabSession } from './lab-contracts.js'

export type { LabSessionStatus } from './lab-contracts.js'

export type LabSession = {
  id: string
  user_id: string
  device_id: string
  status: LabSessionStatus
  created_at: string
  started_at: string | null
  stopped_at: string | null
  gateway_verified_at: string | null
  rx_bytes: string
  tx_bytes: string
  total_bytes: string
  last_handshake_at: string | null
  observed_at: string
}

type SessionState = {
  session: LabSession
  idempotencyKey: string
  baselineRx: bigint
  baselineTx: bigint
  offsetRx: bigint
  offsetTx: bigint
  needsCounterRebase: boolean
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const handshakeFreshnessSeconds = 180
const handshakeWaitMs = 10_000
const handshakePollMs = 250

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new ApiError(400, `${field} must be a UUID.`, 'invalid_request')
  }
}

function isFreshHandshake(observation: GatewayObservation): boolean {
  if (!observation.handshakeAt) return false
  const age = Date.now() - Date.parse(observation.handshakeAt)
  return Number.isFinite(age) && age >= -30_000 && age <= handshakeFreshnessSeconds * 1000
}

export class LabSessionManager {
  private readonly sessions = new Map<string, SessionState>()
  private activeSessionId: string | null = null
  private operation: Promise<void> = Promise.resolve()

  private readonly initialized: Promise<void>

  constructor(
    private readonly gateway: WireGuardGateway,
    private readonly repository?: LabRepository,
  ) {
    this.initialized = this.restoreSessions()
  }

  async checkGateway(): Promise<GatewayObservation> {
    try {
      return await this.gateway.checkAvailability()
    } catch {
      return {
        available: false,
        status: 'unavailable',
        observedAt: new Date().toISOString(),
        rxBytes: null,
        txBytes: null,
        totalBytes: null,
        handshakeAt: null,
        peerPublicKey: null,
        serverPublicKey: null,
        endpoint: null,
      }
    }
  }

  async start(
    userId: string,
    data: UserDataService,
    input: unknown,
  ): Promise<LabSession> {
    await this.initialized
    const body = this.validateStartBody(input)
    return this.exclusive(async () => {
      const persisted = await this.repository?.findLabSessionByIdempotency(userId, body.idempotency_key)
      if (persisted) {
        if (persisted.device_id !== body.device_id) {
          throw new ApiError(409, 'Idempotency key was already used for another device.', 'conflict')
        }
        const restored = this.restoreState(persisted)
        this.sessions.set(restored.session.id, restored)
        return this.refresh(restored)
      }
      const previous = [...this.sessions.values()].find(
        (state) => state.session.user_id === userId && state.idempotencyKey === body.idempotency_key,
      )
      if (previous) {
        if (previous.session.device_id !== body.device_id) {
          throw new ApiError(409, 'Idempotency key was already used for another device.', 'conflict')
        }
        return this.refresh(previous)
      }

      const devices = await data.listDevices(userId)
      const device = devices.find((item) => item.id === body.device_id && item.status === 'active')
      if (!device) throw notFound('Active account device not found.')
      if (this.activeSessionId) {
        const active = this.sessions.get(this.activeSessionId)
        if (active && active.session.status !== 'stopped' && active.session.status !== 'failed') {
          throw new ApiError(409, 'The shared local lab is already in use.', 'lab_busy')
        }
        this.activeSessionId = null
      }

      const current = await this.gateway.checkAvailability()
      if (!current.available || current.status === 'unavailable') {
        throw new ApiError(503, 'The local WireGuard laboratory is unavailable.', 'gateway_unavailable')
      }
      if (current.status === 'connected' || current.status === 'interrupted') {
        throw new ApiError(409, 'An untracked WireGuard lab tunnel is active; stop it before starting a session.', 'lab_orphaned')
      }

      const sessionId = randomUUID()
      const state: SessionState = {
        session: {
          id: sessionId,
          user_id: userId,
          device_id: device.id,
          status: 'connecting',
          created_at: new Date().toISOString(),
          started_at: null,
          stopped_at: null,
          gateway_verified_at: null,
          rx_bytes: '0',
          tx_bytes: '0',
          total_bytes: '0',
          last_handshake_at: null,
          observed_at: new Date().toISOString(),
        },
        idempotencyKey: body.idempotency_key,
        baselineRx: 0n,
        baselineTx: 0n,
        offsetRx: 0n,
        offsetTx: 0n,
        needsCounterRebase: false,
      }
      await this.repository?.createLabSession(this.persistedState(state))
      this.sessions.set(sessionId, state)
      this.activeSessionId = sessionId

      try {
        await this.gateway.authorizeDevice(device.id, sessionId)
        await this.gateway.startSession(sessionId)
        await this.gateway.createConfiguration(device.id, sessionId)
        const observation = await this.waitForHandshake(sessionId)
        if (
          !observation.available
          || observation.status !== 'connected'
          || observation.rxBytes === null
          || observation.txBytes === null
          || !isFreshHandshake(observation)
        ) {
          state.session.status = 'failed'
          this.activeSessionId = null
          throw new ApiError(502, 'The gateway did not confirm a recent WireGuard handshake.', 'handshake_unconfirmed')
        }
        state.baselineRx = BigInt(observation.rxBytes)
        state.baselineTx = BigInt(observation.txBytes)
        state.session.status = 'connected'
        state.session.started_at = observation.handshakeAt
        state.session.gateway_verified_at = observation.observedAt
        this.applyObservation(state, observation)
        await this.save(state)
        return this.copy(state.session)
      } catch (error) {
        try {
          await this.gateway.stopSession(sessionId)
          const stopped = await this.gateway.getSessionStatus(sessionId)
          if (stopped.status !== 'stopped') {
            throw new ApiError(503, 'The failed lab startup could not be stopped.', 'gateway_stop_unconfirmed')
          }
          state.session.status = 'failed'
          state.session.stopped_at = stopped.observedAt
          this.activeSessionId = null
          await this.save(state)
        } catch {
          state.session.status = 'interrupted'
          await this.save(state)
          throw new ApiError(503, 'Lab startup failed and the gateway stop could not be confirmed.', 'gateway_stop_unconfirmed')
        }
        throw error
      }
    })
  }

  async get(userId: string, sessionId: string): Promise<LabSession> {
    await this.initialized
    assertUuid(sessionId, 'sessionId')
    return this.exclusive(async () => {
      const state = this.sessions.get(sessionId)
      if (!state || state.session.user_id !== userId) throw notFound('Lab session not found.')
      return this.refresh(state)
    })
  }

  async current(userId: string): Promise<LabSession | null> {
    await this.initialized
    return this.exclusive(async () => {
      if (!this.activeSessionId) return null
      const state = this.sessions.get(this.activeSessionId)
      if (!state || state.session.user_id !== userId) return null
      return this.refresh(state)
    })
  }

  async reconcile(userId: string): Promise<LabSession[]> {
    await this.initialized
    return this.exclusive(async () => {
      const owned = [...this.sessions.values()].filter((state) => state.session.user_id === userId)
      const reconciled: LabSession[] = []
      for (const state of owned) reconciled.push(await this.refresh(state))
      return reconciled
    })
  }

  async stop(userId: string, sessionId: string): Promise<LabSession> {
    await this.initialized
    assertUuid(sessionId, 'sessionId')
    return this.exclusive(async () => {
      const state = this.sessions.get(sessionId)
      if (!state || state.session.user_id !== userId) throw notFound('Lab session not found.')
      return this.stopState(state)
    })
  }

  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    await this.initialized
    return this.exclusive(async () => {
      if (!this.activeSessionId) return
      const state = this.sessions.get(this.activeSessionId)
      if (state?.session.user_id === userId && state.session.device_id === deviceId) {
        await this.stopState(state)
      }
    })
  }

  private async stopState(state: SessionState): Promise<LabSession> {
    const sessionId = state.session.id
    if (state.session.status === 'stopped') return this.copy(state.session)
    state.session.status = 'stopping'
    await this.save(state)
    try {
      const finalTraffic = await this.gateway.getSessionStatus(sessionId)
      this.applyObservation(state, finalTraffic)
      await this.gateway.stopSession(sessionId)
      const observation = await this.gateway.getSessionStatus(sessionId)
      if (observation.status !== 'stopped') {
        throw new ApiError(503, 'The gateway has not confirmed that the tunnel stopped.', 'gateway_stop_unconfirmed')
      }
      state.session.observed_at = observation.observedAt
      state.session.status = 'stopped'
      state.session.stopped_at = observation.observedAt
      if (this.activeSessionId === sessionId) this.activeSessionId = null
      await this.save(state)
      return this.copy(state.session)
    } catch (error) {
      state.session.status = 'interrupted'
      await this.save(state)
      throw error
    }
  }

  private async refresh(state: SessionState): Promise<LabSession> {
    if (state.session.status === 'stopped' || state.session.status === 'failed') {
      return this.copy(state.session)
    }
    try {
      const observation = await this.gateway.getSessionStatus(state.session.id)
      this.applyObservation(state, observation)
      if (observation.status === 'stopped') {
        state.session.status = 'stopped'
        state.session.stopped_at = observation.observedAt
        if (this.activeSessionId === state.session.id) this.activeSessionId = null
      } else if (observation.status === 'connected' && isFreshHandshake(observation)) {
        state.session.status = 'connected'
      } else {
        state.session.status = 'interrupted'
      }
      await this.save(state)
    } catch {
      state.session.status = 'interrupted'
      await this.save(state)
    }
    return this.copy(state.session)
  }

  private async waitForHandshake(sessionId: string): Promise<GatewayObservation> {
    const deadline = Date.now() + handshakeWaitMs
    let observation = await this.gateway.getSessionStatus(sessionId)
    while (!isFreshHandshake(observation) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, handshakePollMs))
      observation = await this.gateway.getSessionStatus(sessionId)
    }
    return observation
  }

  private applyObservation(state: SessionState, observation: GatewayObservation): void {
    if (!observation.available || observation.rxBytes === null || observation.txBytes === null) return
    const rx = BigInt(observation.rxBytes)
    const tx = BigInt(observation.txBytes)
    if (state.needsCounterRebase) {
      state.baselineRx = rx
      state.baselineTx = tx
      state.needsCounterRebase = false
    }
    const rxDelta = rx >= state.baselineRx ? rx - state.baselineRx : 0n
    const txDelta = tx >= state.baselineTx ? tx - state.baselineTx : 0n
    state.session.rx_bytes = (state.offsetRx + rxDelta).toString()
    state.session.tx_bytes = (state.offsetTx + txDelta).toString()
    state.session.total_bytes = (state.offsetRx + state.offsetTx + rxDelta + txDelta).toString()
    state.session.last_handshake_at = observation.handshakeAt
    state.session.observed_at = observation.observedAt
  }

  private validateStartBody(input: unknown): { device_id: string; idempotency_key: string } {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new ApiError(400, 'Request body must be an object.', 'invalid_request')
    }
    const body = input as Record<string, unknown>
    const keys = Object.keys(body)
    if (keys.some((key) => key !== 'device_id' && key !== 'idempotency_key')) {
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

  private copy(session: LabSession): LabSession {
    return { ...session }
  }

  private async restoreSessions(): Promise<void> {
    if (!this.repository) return
    const sessions = await this.repository.getOpenLabSessions('shared_lab')
    if (sessions.length > 1) {
      throw new ApiError(503, 'Multiple persisted shared-lab sessions require manual reconciliation.', 'lab_reconciliation_required')
    }
    for (const persisted of sessions) {
      const state = this.restoreState(persisted)
      this.sessions.set(state.session.id, state)
      this.activeSessionId = state.session.id
      try {
        const observation = await this.gateway.getSessionStatus(state.session.id)
        this.applyObservation(state, observation)
        if (observation.status === 'connected' && isFreshHandshake(observation)) {
          state.session.status = 'connected'
        } else if (observation.status === 'stopped' && persisted.status === 'stopping') {
          state.session.status = 'stopped'
          state.session.stopped_at = observation.observedAt
          this.activeSessionId = null
        } else {
          state.session.status = 'interrupted'
        }
      } catch {
        state.session.status = 'interrupted'
      }
      await this.save(state)
    }
  }

  private restoreState(persisted: PersistentLabSession): SessionState {
    return {
      session: {
        id: persisted.id,
        user_id: persisted.user_id,
        device_id: persisted.device_id,
        status: persisted.status,
        created_at: persisted.created_at,
        started_at: persisted.started_at,
        stopped_at: persisted.stopped_at,
        gateway_verified_at: persisted.last_handshake_at,
        rx_bytes: persisted.rx_bytes,
        tx_bytes: persisted.tx_bytes,
        total_bytes: (BigInt(persisted.rx_bytes) + BigInt(persisted.tx_bytes)).toString(),
        last_handshake_at: persisted.last_handshake_at,
        observed_at: persisted.last_observed_at ?? persisted.updated_at,
      },
      idempotencyKey: persisted.idempotency_key,
      baselineRx: BigInt(persisted.baseline_rx_bytes),
      baselineTx: BigInt(persisted.baseline_tx_bytes),
      offsetRx: BigInt(persisted.rx_bytes),
      offsetTx: BigInt(persisted.tx_bytes),
      needsCounterRebase: true,
    }
  }

  private persistedState(state: SessionState): PersistentLabSession {
    return {
      id: state.session.id,
      user_id: state.session.user_id,
      device_id: state.session.device_id,
      peer_id: null,
      gateway_mode: 'shared_lab',
      idempotency_key: state.idempotencyKey,
      status: state.session.status,
      baseline_rx_bytes: state.baselineRx.toString(),
      baseline_tx_bytes: state.baselineTx.toString(),
      rx_bytes: state.session.rx_bytes,
      tx_bytes: state.session.tx_bytes,
      last_handshake_at: state.session.last_handshake_at,
      last_observed_at: state.session.observed_at,
      created_at: state.session.created_at,
      updated_at: new Date().toISOString(),
      started_at: state.session.started_at,
      stopped_at: state.session.stopped_at,
    }
  }

  private async save(state: SessionState): Promise<void> {
    await this.repository?.updateLabSession(this.persistedState(state))
  }
}
