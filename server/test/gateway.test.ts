import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { UsageEventRecorder } from '../src/contracts.js'
import { createApp } from '../src/app.js'
import type { ServerConfig } from '../src/config.js'

const secret = 'test-secret-with-at-least-thirty-two-bytes'
const config: ServerConfig = {
  port: 3001,
  supabaseUrl: 'https://project.example.test',
  supabaseAnonKey: 'test-publishable-key',
  allowedOrigins: [],
  gatewayWebhookSecret: secret,
}

let server: ReturnType<ReturnType<typeof createApp>['listen']>
let baseUrl = ''
const recorded: string[] = []
const recorder: UsageEventRecorder = {
  async record(event) {
    recorded.push(event.event_id)
    return '0'
  },
}

before(async () => {
  server = createApp(config, { usageEventRecorder: recorder }).listen(0)
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
})

async function sendEvent(payload: object, timestamp: string, signatureOverride?: string) {
  const rawBody = JSON.stringify(payload)
  const signature = signatureOverride ?? createHmac('sha256', secret)
    .update(timestamp)
    .update('.')
    .update(rawBody)
    .digest('hex')

  return fetch(`${baseUrl}/internal/v1/gateway/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DataPlus-Timestamp': timestamp,
      'X-DataPlus-Signature': `v1=${signature}`,
    },
    body: rawBody,
  })
}

test('gateway event rejects invalid signatures and stale timestamps', async () => {
  const payload = {
    event_id: randomUUID(),
    session_id: randomUUID(),
    sequence: '1',
    rx_bytes: '0',
    tx_bytes: '0',
  }
  const now = Math.floor(Date.now() / 1000)
  assert.equal((await sendEvent(payload, String(now), 'v1=' + '0'.repeat(64))).status, 401)
  assert.equal((await sendEvent(payload, String(now - 301))).status, 401)
  assert.equal(recorded.length, 0)
})

test('gateway event validates signed counters before recording', async () => {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const eventId = randomUUID()
  const invalid = await sendEvent({
    event_id: eventId,
    session_id: randomUUID(),
    sequence: '01',
    rx_bytes: '0',
    tx_bytes: '0',
  }, timestamp)
  assert.equal(invalid.status, 400)
  assert.equal(recorded.length, 0)

  const valid = await sendEvent({
    event_id: eventId,
    session_id: randomUUID(),
    sequence: '1',
    rx_bytes: '1024',
    tx_bytes: '2048',
  }, timestamp)
  assert.equal(valid.status, 202)
  assert.equal((await valid.json()).data.delta_bytes, '0')
  assert.deepEqual(recorded, [eventId])
})
