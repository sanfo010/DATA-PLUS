import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type {
  AuthenticatedContext,
  AuthenticatedUser,
  DeviceRecord,
  ProfileRecord,
  SessionRecord,
  TokenAuthenticator,
  UserDataService,
} from '../src/contracts.js'
import { createApp } from '../src/app.js'
import type { ServerConfig } from '../src/config.js'

const userA: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'a@example.test',
}
const userB: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000002',
  email: 'b@example.test',
}
const deviceAId = '10000000-0000-4000-8000-000000000001'
const deviceBId = '10000000-0000-4000-8000-000000000002'
const sessionAId = '20000000-0000-4000-8000-000000000001'

const device = (ownerId: string, id: string): DeviceRecord => ({
  id,
  user_id: ownerId,
  device_name: 'Test device',
  platform: 'web',
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  last_seen_at: null,
  revoked_at: null,
})

const session = (ownerId: string, id: string, deviceId: string): SessionRecord => ({
  id,
  user_id: ownerId,
  device_id: deviceId,
  status: 'requested',
  reserved_bytes: 0,
  consumed_bytes: 0,
  remaining_bytes: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  started_at: null,
  stopped_at: null,
  gateway_verified_at: null,
})

class MemoryDataService implements UserDataService {
  readonly devices = new Map<string, DeviceRecord>()
  readonly sessions = new Map<string, SessionRecord>()
  readonly requestedBy: Array<{ deviceId: string; key: string }> = []
  readonly ownerId: string

  constructor(userId: string, deviceId: string, sessionId?: string) {
    this.ownerId = userId
    this.devices.set(deviceId, device(userId, deviceId))
    if (sessionId) this.sessions.set(sessionId, session(userId, sessionId, deviceId))
  }

  async getProfile(userId: string): Promise<ProfileRecord | null> {
    if (userId !== this.ownerId) return null
    return {
      id: userId,
      full_name: 'Test user',
      avatar_url: null,
      created_at: '2026-01-01T00:00:00.000Z',
      last_sign_in_at: null,
    }
  }

  async listDevices(userId: string): Promise<DeviceRecord[]> {
    if (userId !== this.ownerId) return []
    return [...this.devices.values()].filter((item) => item.user_id === userId)
  }

  async registerDevice(
    deviceName: string,
    platform: DeviceRecord['platform'],
    _idempotencyKey: string,
  ): Promise<DeviceRecord> {
    const id = '10000000-0000-4000-8000-000000000003'
    const created = { ...device(this.ownerId, id), device_name: deviceName, platform }
    this.devices.set(id, created)
    return created
  }

  async revokeDevice(userId: string, deviceId: string): Promise<DeviceRecord> {
    const found = this.devices.get(deviceId)
    if (userId !== this.ownerId || !found) throw Object.assign(new Error('Device not found'), { databaseCode: 'P0002' })
    const revoked = { ...found, status: 'revoked' as const, revoked_at: '2026-01-02T00:00:00.000Z' }
    this.devices.set(deviceId, revoked)
    return revoked
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    if (userId !== this.ownerId) return []
    return [...this.sessions.values()].filter((item) => item.user_id === userId)
  }

  async getSession(userId: string, sessionId: string): Promise<SessionRecord | null> {
    const found = this.sessions.get(sessionId)
    return found?.user_id === userId ? found : null
  }

  async requestSession(deviceId: string, idempotencyKey: string): Promise<SessionRecord> {
    this.requestedBy.push({ deviceId, key: idempotencyKey })
    const id = '20000000-0000-4000-8000-000000000002'
    const requested = session(this.ownerId, id, deviceId)
    this.sessions.set(id, requested)
    return requested
  }

  async stopSession(userId: string, sessionId: string): Promise<SessionRecord | null> {
    const found = await this.getSession(userId, sessionId)
    if (!found) return null
    const stopped = { ...found, status: 'stopped' as const, stopped_at: '2026-01-02T00:00:00.000Z' }
    this.sessions.set(sessionId, stopped)
    return stopped
  }
}

class TestAuthenticator implements TokenAuthenticator {
  private readonly contexts = new Map<string, AuthenticatedContext>()

  constructor() {
    this.contexts.set('test-user-a-token', {
      user: userA,
      data: new MemoryDataService(userA.id, deviceAId, sessionAId),
    })
    this.contexts.set('test-user-b-token', {
      user: userB,
      data: new MemoryDataService(userB.id, deviceBId),
    })
  }

  async authenticate(token: string): Promise<AuthenticatedContext | null> {
    return this.contexts.get(token) ?? null
  }
}

const config: ServerConfig = {
  port: 3001,
  supabaseUrl: 'https://project.example.test',
  supabaseAnonKey: 'test-publishable-key',
  allowedOrigins: ['http://localhost:5173'],
}

let server: ReturnType<ReturnType<typeof createApp>['listen']>
let baseUrl = ''
let authenticator: TestAuthenticator

before(async () => {
  authenticator = new TestAuthenticator()
  server = createApp(config, { authenticator }).listen(0)
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
})

async function request(path: string, options: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, options)
}

function auth(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
}

test('health and capabilities never claim a configured VPN', async () => {
  const health = await request('/health')
  assert.equal(health.status, 200)
  const capabilities = await request('/api/v1/capabilities')
  assert.deepEqual((await capabilities.json()).data, {
    gateway: 'unconfigured',
    labSessions: 'disabled',
    devicePeers: 'disabled',
    labSessionPersistence: 'disabled',
    trafficMetering: 'gateway_events_only',
    walletMutations: false,
  })
})

test('protected routes reject a missing or invalid bearer token', async () => {
  assert.equal((await request('/api/v1/me')).status, 401)
  assert.equal((await request('/api/v1/me', { headers: auth('invalid') })).status, 401)
})

test('the verified identity and own devices are returned', async () => {
  const meResponse = await request('/api/v1/me', { headers: auth('test-user-a-token') })
  assert.equal(meResponse.status, 200)
  assert.equal((await meResponse.json()).data.id, userA.id)

  const devicesResponse = await request('/api/v1/devices', { headers: auth('test-user-b-token') })
  assert.equal(devicesResponse.status, 200)
  const rows = (await devicesResponse.json()).data as DeviceRecord[]
  assert.equal(rows.length, 1)
  assert.equal(rows[0].user_id, userB.id)
  assert.equal(rows[0].id, deviceBId)
})

test('registration rejects unsupported fields and invalid device data', async () => {
  const extraUserId = await request('/api/v1/devices', {
    method: 'POST',
    headers: { ...auth('test-user-a-token'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_name: 'Browser',
      platform: 'web',
      idempotency_key: '30000000-0000-4000-8000-000000000001',
      user_id: userB.id,
    }),
  })
  assert.equal(extraUserId.status, 400)

  const invalidPlatform = await request('/api/v1/devices', {
    method: 'POST',
    headers: { ...auth('test-user-a-token'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_name: 'Browser',
      platform: 'desktop',
      idempotency_key: '30000000-0000-4000-8000-000000000001',
    }),
  })
  assert.equal(invalidPlatform.status, 400)
})

test('a user can register and revoke only their own device', async () => {
  const created = await request('/api/v1/devices', {
    method: 'POST',
    headers: { ...auth('test-user-a-token'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_name: 'My browser',
      platform: 'web',
      idempotency_key: '30000000-0000-4000-8000-000000000003',
    }),
  })
  assert.equal(created.status, 201)
  const newDevice = (await created.json()).data as DeviceRecord
  assert.equal(newDevice.user_id, userA.id)
  assert.equal(newDevice.device_name, 'My browser')

  const revoked = await request(`/api/v1/devices/${newDevice.id}/revoke`, {
    method: 'POST',
    headers: { ...auth('test-user-a-token'), 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(revoked.status, 200)
  assert.equal((await revoked.json()).data.status, 'revoked')
})

test('session requests use authenticated context and reject client user ids', async () => {
  const invalid = await request('/api/v1/sessions', {
    method: 'POST',
    headers: { ...auth('test-user-a-token'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: deviceAId,
      idempotency_key: '30000000-0000-4000-8000-000000000002',
      user_id: userB.id,
    }),
  })
  assert.equal(invalid.status, 400)

  const created = await request('/api/v1/sessions', {
    method: 'POST',
    headers: { ...auth('test-user-a-token'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: deviceAId,
      idempotency_key: '30000000-0000-4000-8000-000000000002',
    }),
  })
  assert.equal(created.status, 201)
  const row = (await created.json()).data as SessionRecord
  assert.equal(row.user_id, userA.id)
  assert.equal(row.status, 'requested')
  assert.equal(row.reserved_bytes, 0)
})

test('users cannot read or stop another account session', async () => {
  const read = await request(`/api/v1/sessions/${sessionAId}`, {
    headers: auth('test-user-b-token'),
  })
  assert.equal(read.status, 404)

  const stop = await request(`/api/v1/sessions/${sessionAId}/stop`, {
    method: 'POST',
    headers: { ...auth('test-user-b-token'), 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(stop.status, 404)
})

test('a session owner can request a stop', async () => {
  const response = await request(`/api/v1/sessions/${sessionAId}/stop`, {
    method: 'POST',
    headers: { ...auth('test-user-a-token'), 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.status, 'stopped')
})

test('session ids and request bodies are validated', async () => {
  const invalidId = await request('/api/v1/sessions/not-a-uuid', {
    headers: auth('test-user-a-token'),
  })
  assert.equal(invalidId.status, 400)
  const invalidBody = await request('/api/v1/sessions', {
    method: 'POST',
    headers: { ...auth('test-user-a-token'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: 'bad', idempotency_key: 'bad' }),
  })
  assert.equal(invalidBody.status, 400)

  const malformedJson = await request('/api/v1/sessions', {
    method: 'POST',
    headers: { ...auth('test-user-a-token'), 'Content-Type': 'application/json' },
    body: '{"device_id":',
  })
  assert.equal(malformedJson.status, 400)
})

test('gateway event intake is unavailable until configured', async () => {
  const response = await request('/internal/v1/gateway/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(response.status, 503)
})
