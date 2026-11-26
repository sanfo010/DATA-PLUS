import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { AuthenticatedContext, TokenAuthenticator } from '../src/contracts.js'
import { createApp } from '../src/app.js'
import { LocalWslWireGuardGateway } from '../src/gateway-local-wsl.js'
import type { ServerConfig } from '../src/config.js'

const userId = '00000000-0000-4000-8000-000000000001'
const deviceId = '10000000-0000-4000-8000-000000000001'
const gateway = new LocalWslWireGuardGateway()
const context = {
  user: { id: userId, email: 'lab@example.test' },
  data: {
    async listDevices(requestedUserId: string) {
      return requestedUserId === userId
        ? [{
          id: deviceId,
          user_id: userId,
          device_name: 'Local test device',
          platform: 'web' as const,
          status: 'active' as const,
          created_at: new Date().toISOString(),
          last_seen_at: null,
          revoked_at: null,
        }]
        : []
    },
  },
} as unknown as AuthenticatedContext
const authenticator: TokenAuthenticator = {
  async authenticate(token) {
    return token === 'local-wsl-integration-test' ? context : null
  },
}
const config: ServerConfig = {
  port: 3001,
  supabaseUrl: 'https://project.example.test',
  supabaseAnonKey: 'test-publishable-key',
  allowedOrigins: [],
}

let server: ReturnType<ReturnType<typeof createApp>['listen']>
let baseUrl = ''
let activeSessionId: string | null = null

before(async () => {
  server = createApp(config, { authenticator, gateway }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/lab`
})

after(async () => {
  try {
    if (activeSessionId) {
      await gateway.stopSession(activeSessionId)
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
})

const headers = {
  Authorization: 'Bearer local-wsl-integration-test',
  'Content-Type': 'application/json',
}

test('authenticated lab API observes a real WSL handshake, counters and stop', async () => {
  const initial = await fetch(`${baseUrl}/gateway`, { headers })
  assert.equal(initial.status, 200)
  assert.equal((await initial.json()).data.status, 'stopped')

  const started = await fetch(`${baseUrl}/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ device_id: deviceId, idempotency_key: randomUUID() }),
  })
  assert.equal(started.status, 201)
  const session = (await started.json()).data
  activeSessionId = session.id
  assert.equal(session.status, 'connected')
  assert.ok(session.gateway_verified_at)

  const observation = await fetch(`${baseUrl}/gateway`, { headers })
  assert.equal(observation.status, 200)
  const measurements = (await observation.json()).data
  assert.equal(measurements.status, 'connected')
  assert.ok(measurements.handshakeAt)
  assert.ok(BigInt(measurements.rxBytes) + BigInt(measurements.txBytes) > 0n)

  const stop = await fetch(`${baseUrl}/sessions/${session.id}/stop`, {
    method: 'POST',
    headers,
    body: '{}',
  })
  assert.equal(stop.status, 200)
  assert.equal((await stop.json()).data.status, 'stopped')
  activeSessionId = null

  const finalStatus = await fetch(`${baseUrl}/sessions/${session.id}`, { headers })
  assert.equal(finalStatus.status, 200)
  assert.equal((await finalStatus.json()).data.status, 'stopped')
  const finalGateway = await gateway.checkAvailability()
  assert.equal(finalGateway.status, 'stopped')
})
