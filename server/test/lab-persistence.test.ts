import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type { DeviceRecord, UserDataService } from '../src/contracts.js'
import type {
  GatewayConnectionConfiguration,
  GatewayObservation,
  WireGuardGateway,
} from '../src/gateway.js'
import type {
  LabRepository,
  NewWireGuardDevicePeer,
  PersistentLabSession,
  WireGuardDevicePeer,
} from '../src/lab-contracts.js'
import { LabSessionManager } from '../src/lab-sessions.js'

const userId = '00000000-0000-4000-8000-000000000001'
const deviceId = '10000000-0000-4000-8000-000000000001'

class SessionRepository implements LabRepository {
  readonly sessions = new Map<string, PersistentLabSession>()
  async createPeer(_peer: NewWireGuardDevicePeer): Promise<WireGuardDevicePeer> { throw new Error('not used') }
  async getPeer() { return null }
  async listPeers() { return [] }
  async revokePeer() { return null }
  async findLabSessionByIdempotency(user: string, key: string) {
    return [...this.sessions.values()].find((item) => item.user_id === user && item.idempotency_key === key) ?? null
  }
  async getLabSession(user: string, sessionId: string) {
    const session = this.sessions.get(sessionId)
    return session?.user_id === user ? session : null
  }
  async createLabSession(session: PersistentLabSession) { this.sessions.set(session.id, { ...session }) }
  async updateLabSession(session: PersistentLabSession) { this.sessions.set(session.id, { ...session }) }
  async getOpenLabSessions(mode: PersistentLabSession['gateway_mode']) {
    return [...this.sessions.values()].filter((session) =>
      session.gateway_mode === mode
      && ['requested', 'authorized', 'connecting', 'connected', 'interrupted', 'stopping'].includes(session.status))
  }
}

class PersistentGateway implements WireGuardGateway {
  state: 'stopped' | 'connected' = 'stopped'
  rxBytes = 250n
  txBytes = 500n
  handshakeAt: string | null = null
  async checkAvailability() { return this.observation() }
  async authorizeDevice() {}
  async createConfiguration(): Promise<GatewayConnectionConfiguration> {
    return {
      endpoint: '10.88.0.1:51820',
      peerPublicKey: Buffer.alloc(32, 1).toString('base64'),
      allowedIps: ['10.77.0.1/32'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
  }
  async startSession() {
    this.state = 'connected'
    this.handshakeAt = new Date().toISOString()
  }
  async getSessionStatus() { return this.observation() }
  async stopSession() {
    this.state = 'stopped'
    this.handshakeAt = null
  }
  async revokeDevice() {}
  private observation(): GatewayObservation {
    return {
      available: true,
      status: this.state,
      observedAt: new Date().toISOString(),
      rxBytes: this.rxBytes.toString(),
      txBytes: this.txBytes.toString(),
      totalBytes: (this.rxBytes + this.txBytes).toString(),
      handshakeAt: this.handshakeAt,
      peerPublicKey: Buffer.alloc(32, 1).toString('base64'),
      serverPublicKey: Buffer.alloc(32, 2).toString('base64'),
      endpoint: '10.88.0.1:51820',
    }
  }
}

const data: UserDataService = {
  async getProfile() { return null },
  async listDevices(userIdValue): Promise<DeviceRecord[]> {
    return userIdValue === userId ? [{
      id: deviceId,
      user_id: userId,
      device_name: 'Local persistence test',
      platform: 'android',
      status: 'active',
      created_at: new Date().toISOString(),
      last_seen_at: null,
      revoked_at: null,
    }] : []
  },
  async registerDevice() { throw new Error('not used') },
  async revokeDevice() { throw new Error('not used') },
  async listSessions() { return [] },
  async getSession() { return null },
  async requestSession() { throw new Error('not used') },
  async stopSession() { return null },
}

test('persisted lab sessions restore with verified state and counter deltas do not double count', async () => {
  const repository = new SessionRepository()
  const gateway = new PersistentGateway()
  const firstProcess = new LabSessionManager(gateway, repository)
  const session = await firstProcess.start(userId, data, {
    device_id: deviceId,
    idempotency_key: randomUUID(),
  })
  assert.equal(session.status, 'connected')

  gateway.rxBytes = 300n
  gateway.txBytes = 600n
  const beforeRestart = await firstProcess.get(userId, session.id)
  assert.equal(beforeRestart.rx_bytes, '50')
  assert.equal(beforeRestart.tx_bytes, '100')

  const afterRestart = new LabSessionManager(gateway, repository)
  const restored = await afterRestart.get(userId, session.id)
  assert.equal(restored.status, 'connected')
  assert.equal(restored.rx_bytes, '50')
  assert.equal(restored.tx_bytes, '100')

  gateway.rxBytes = 305n
  gateway.txBytes = 609n
  const updated = await afterRestart.get(userId, session.id)
  assert.equal(updated.rx_bytes, '55')
  assert.equal(updated.tx_bytes, '109')
  assert.equal(updated.total_bytes, '164')

  gateway.handshakeAt = null
  const withoutProof = new LabSessionManager(gateway, repository)
  const reconciled = await withoutProof.reconcile(userId)
  assert.equal(reconciled[0].status, 'interrupted')
})
