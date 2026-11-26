import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type {
  AuthenticatedContext,
  DeviceRecord,
  TokenAuthenticator,
  UserDataService,
} from '../src/contracts.js'
import { createApp } from '../src/app.js'
import type { ServerConfig } from '../src/config.js'
import type {
  GatewayConnectionConfiguration,
  GatewayObservation,
  WireGuardGateway,
} from '../src/gateway.js'

const userA = { id: '00000000-0000-4000-8000-000000000001', email: 'a@example.test' }
const userB = { id: '00000000-0000-4000-8000-000000000002', email: 'b@example.test' }
const deviceA = '10000000-0000-4000-8000-000000000001'
const deviceB = '10000000-0000-4000-8000-000000000002'
const idempotencyKey = '30000000-0000-4000-8000-000000000001'

const makeDevice = (userId: string, id: string): DeviceRecord => ({
  id,
  user_id: userId,
  device_name: 'Test device',
  platform: 'web',
  status: 'active',
  created_at: new Date().toISOString(),
  last_seen_at: null,
  revoked_at: null,
})

class DeviceData implements UserDataService {
  constructor(private readonly userId: string, private readonly deviceId: string) {}
  async getProfile() { return null }
  async listDevices(userId: string) {
    return userId === this.userId ? [makeDevice(this.userId, this.deviceId)] : []
  }
  async registerDevice(): Promise<DeviceRecord> { throw new Error('not used') }
  async revokeDevice(userId: string, id: string): Promise<DeviceRecord> {
    if (userId !== this.userId || id !== this.deviceId) throw new Error('Device not found')
    return { ...makeDevice(this.userId, this.deviceId), status: 'revoked', revoked_at: new Date().toISOString() }
  }
  async listSessions() { return [] }
  async getSession() { return null }
  async requestSession() { throw new Error('not used') }
  async stopSession() { return null }
}

class LabAuthenticator implements TokenAuthenticator {
  async authenticate(token: string): Promise<AuthenticatedContext | null> {
    if (token === 'a') return { user: userA, data: new DeviceData(userA.id, deviceA) }
    if (token === 'b') return { user: userB, data: new DeviceData(userB.id, deviceB) }
    return null
  }
}

class TestGateway implements WireGuardGateway {
  state: 'stopped' | 'connected' = 'stopped'
  starts = 0
  stops = 0
  handshakeAt: string | null = null
  private rxBytes = 250n
  private txBytes = 500n

  async checkAvailability(): Promise<GatewayObservation> {
    return this.observation()
  }
  async authorizeDevice() {}
  async createConfiguration(): Promise<GatewayConnectionConfiguration> {
    return {
      endpoint: '10.88.0.1:51820',
      peerPublicKey: 'A'.repeat(43) + '=',
      allowedIps: ['10.77.0.1/32'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
  }
  async startSession() {
    this.starts++
    this.state = 'connected'
    this.handshakeAt = new Date().toISOString()
  }
  async getSessionStatus() { return this.observation() }
  async stopSession() {
    this.stops++
    this.state = 'stopped'
    this.handshakeAt = null
  }
  async revokeDevice() {}

  private observation(): GatewayObservation {
    return {
      available: true,
      status: this.state === 'stopped' ? 'stopped' : 'connected',
      observedAt: new Date().toISOString(),
      rxBytes: this.rxBytes.toString(),
      txBytes: this.txBytes.toString(),
      totalBytes: (this.rxBytes + this.txBytes).toString(),
      handshakeAt: this.handshakeAt,
      peerPublicKey: 'A'.repeat(43) + '=',
      serverPublicKey: 'B'.repeat(43) + '=',
      endpoint: '10.88.0.1:51820',
    }
  }
}

const config: ServerConfig = {
  port: 3001,
  supabaseUrl: 'https://project.example.test',
  supabaseAnonKey: 'test-publishable-key',
  allowedOrigins: [],
}

let server: ReturnType<ReturnType<typeof createApp>['listen']>
let baseUrl = ''
let gateway: TestGateway

before(async () => {
  gateway = new TestGateway()
  server = createApp(config, { authenticator: new LabAuthenticator(), gateway }).listen(0)
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
})

const auth = (token: string): HeadersInit => ({ Authorization: `Bearer ${token}` })

test('lab sessions require auth, an active owned device, and a real handshake', async () => {
  assert.equal((await fetch(`${baseUrl}/api/v1/lab/gateway`)).status, 401)
  const forbiddenDevice = await fetch(`${baseUrl}/api/v1/lab/sessions`, {
    method: 'POST',
    headers: { ...auth('a'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceB, idempotency_key: idempotencyKey }),
  })
  assert.equal(forbiddenDevice.status, 404)

  const started = await fetch(`${baseUrl}/api/v1/lab/sessions`, {
    method: 'POST',
    headers: { ...auth('a'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceA, idempotency_key: idempotencyKey }),
  })
  assert.equal(started.status, 201)
  const session = (await started.json()).data
  assert.equal(session.status, 'connected')
  assert.equal(session.gateway_verified_at !== null, true)
  assert.equal(session.total_bytes, '0')
  assert.equal(gateway.starts, 1)
  const current = await fetch(`${baseUrl}/api/v1/lab/sessions/current`, { headers: auth('a') })
  assert.equal((await current.json()).data.id, session.id)

  const repeated = await fetch(`${baseUrl}/api/v1/lab/sessions`, {
    method: 'POST',
    headers: { ...auth('a'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceA, idempotency_key: idempotencyKey }),
  })
  assert.equal(repeated.status, 201)
  assert.equal((await repeated.json()).data.id, session.id)
  assert.equal(gateway.starts, 1)

  const secondSession = await fetch(`${baseUrl}/api/v1/lab/sessions`, {
    method: 'POST',
    headers: { ...auth('b'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: deviceB,
      idempotency_key: '30000000-0000-4000-8000-000000000003',
    }),
  })
  assert.equal(secondSession.status, 409)

  const otherOwner = await fetch(`${baseUrl}/api/v1/lab/sessions/${session.id}`, { headers: auth('b') })
  assert.equal(otherOwner.status, 404)
  const otherOwnerStop = await fetch(`${baseUrl}/api/v1/lab/sessions/${session.id}/stop`, {
    method: 'POST',
    headers: { ...auth('b'), 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(otherOwnerStop.status, 404)

  const unsupportedField = await fetch(`${baseUrl}/api/v1/lab/sessions`, {
    method: 'POST',
    headers: { ...auth('b'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: deviceB,
      idempotency_key: '30000000-0000-4000-8000-000000000004',
      user_id: userA.id,
    }),
  })
  assert.equal(unsupportedField.status, 400)
  const cleanup = await fetch(`${baseUrl}/api/v1/lab/sessions/${session.id}/stop`, {
    method: 'POST',
    headers: { ...auth('a'), 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal((await cleanup.json()).data.status, 'stopped')
})

test('lab session stop is owner-scoped and confirmed by the gateway', async () => {
  const priorStops = gateway.stops
  const start = await fetch(`${baseUrl}/api/v1/lab/sessions`, {
    method: 'POST',
    headers: { ...auth('b'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: deviceB,
      idempotency_key: '30000000-0000-4000-8000-000000000002',
    }),
  })
  assert.equal(start.status, 201)
  const session = (await start.json()).data
  const invalidStop = await fetch(`${baseUrl}/api/v1/lab/sessions/${session.id}/stop`, {
    method: 'POST',
    headers: { ...auth('b'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: true }),
  })
  assert.equal(invalidStop.status, 400)
  const stopped = await fetch(`${baseUrl}/api/v1/lab/sessions/${session.id}/stop`, {
    method: 'POST',
    headers: { ...auth('b'), 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(stopped.status, 200)
  assert.equal((await stopped.json()).data.status, 'stopped')
  assert.equal(gateway.stops, priorStops + 1)
})

test('revoking the session device first stops its active lab tunnel', async () => {
  const start = await fetch(`${baseUrl}/api/v1/lab/sessions`, {
    method: 'POST',
    headers: { ...auth('a'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: deviceA,
      idempotency_key: '30000000-0000-4000-8000-000000000005',
    }),
  })
  assert.equal(start.status, 201)
  const priorStops = gateway.stops
  const revoke = await fetch(`${baseUrl}/api/v1/devices/${deviceA}/revoke`, {
    method: 'POST',
    headers: { ...auth('a'), 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(revoke.status, 200)
  assert.equal((await revoke.json()).data.status, 'revoked')
  assert.equal(gateway.stops, priorStops + 1)
  assert.equal(gateway.state, 'stopped')
})

test('an untracked live gateway tunnel blocks a new lab session', async () => {
  gateway.state = 'connected'
  gateway.handshakeAt = new Date().toISOString()
  const startsBefore = gateway.starts
  try {
    const response = await fetch(`${baseUrl}/api/v1/lab/sessions`, {
      method: 'POST',
      headers: { ...auth('a'), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceA,
        idempotency_key: '30000000-0000-4000-8000-000000000006',
      }),
    })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error.code, 'lab_orphaned')
    assert.equal(gateway.starts, startsBefore)
  } finally {
    gateway.state = 'stopped'
    gateway.handshakeAt = null
  }
})
