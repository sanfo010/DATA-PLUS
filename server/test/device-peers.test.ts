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
import type { DeviceWireGuardGateway, LocalWireGuardPeer } from '../src/gateway-wsl-devices.js'
import type { LabRepository, NewWireGuardDevicePeer, PersistentLabSession, WireGuardDevicePeer } from '../src/lab-contracts.js'

const userA = '00000000-0000-4000-8000-000000000001'
const userB = '00000000-0000-4000-8000-000000000002'
const deviceA = '10000000-0000-4000-8000-000000000001'
const deviceA2 = '10000000-0000-4000-8000-000000000003'
const deviceB = '10000000-0000-4000-8000-000000000002'

function accountDevice(userId: string, id: string): DeviceRecord {
  return {
    id,
    user_id: userId,
    device_name: 'Local test device',
    platform: 'android',
    status: 'active',
    created_at: new Date().toISOString(),
    last_seen_at: null,
    revoked_at: null,
  }
}

class DeviceData implements UserDataService {
  constructor(private readonly userId: string) {}
  async getProfile() { return null }
  async listDevices(userId: string) {
    if (userId !== this.userId) return []
    return this.userId === userA
      ? [accountDevice(userA, deviceA), accountDevice(userA, deviceA2)]
      : [accountDevice(userB, deviceB)]
  }
  async registerDevice() { throw new Error('not used') }
  async revokeDevice(userId: string, id: string) {
    const found = (await this.listDevices(userId)).find((candidate) => candidate.id === id)
    if (!found) throw new Error('not found')
    return { ...found, status: 'revoked' as const, revoked_at: new Date().toISOString() }
  }
  async listSessions() { return [] }
  async getSession() { return null }
  async requestSession() { throw new Error('not used') }
  async stopSession() { return null }
}

class DeviceAuthenticator implements TokenAuthenticator {
  async authenticate(token: string): Promise<AuthenticatedContext | null> {
    if (token === 'a') return { user: { id: userA, email: undefined }, data: new DeviceData(userA) }
    if (token === 'b') return { user: { id: userB, email: undefined }, data: new DeviceData(userB) }
    return null
  }
}

class DeviceGateway implements DeviceWireGuardGateway {
  readonly peers = new Map<string, LocalWireGuardPeer>()

  async enrollPublicKey(deviceId: string, publicKey: string): Promise<LocalWireGuardPeer> {
    const existing = this.peers.get(deviceId)
    if (existing?.status === 'revoked') throw new Error('revoked')
    if (existing) {
      if (existing.publicKey !== publicKey) throw new Error('key mismatch')
      return existing
    }
    const index = this.peers.size + 1
    const peer: LocalWireGuardPeer = {
      deviceId,
      publicKey,
      assignedIp: `10.78.0.${index + 9}`,
      status: 'active',
      interfaceLoaded: true,
      createdAt: new Date().toISOString(),
      handshakeAt: null,
      rxBytes: '0',
      txBytes: '0',
      serverPublicKey: Buffer.alloc(32, 99).toString('base64'),
      listenPort: 51821,
    }
    this.peers.set(deviceId, peer)
    return peer
  }
  async getDeviceStatus(deviceId: string) { return this.peers.get(deviceId) ?? null }
  async revokeDevice(deviceId: string) {
    const peer = this.peers.get(deviceId)
    if (peer) this.peers.set(deviceId, { ...peer, status: 'revoked', interfaceLoaded: false })
  }
}

class DeviceRepository implements LabRepository {
  readonly peers = new Map<string, WireGuardDevicePeer>()
  readonly sessions = new Map<string, PersistentLabSession>()
  private peerKey(userId: string, deviceId: string) { return `${userId}:${deviceId}` }
  async createPeer(input: NewWireGuardDevicePeer): Promise<WireGuardDevicePeer> {
    const peer = { ...input, created_at: new Date().toISOString(), revoked_at: null }
    this.peers.set(this.peerKey(peer.user_id, peer.device_id), peer)
    return peer
  }
  async getPeer(userId: string, deviceId: string) {
    return this.peers.get(this.peerKey(userId, deviceId)) ?? null
  }
  async listPeers(userId: string) {
    return [...this.peers.values()].filter((peer) => peer.user_id === userId)
  }
  async revokePeer(userId: string, deviceId: string) {
    const peer = await this.getPeer(userId, deviceId)
    if (!peer || peer.status === 'revoked') return null
    const revoked = { ...peer, status: 'revoked' as const, revoked_at: new Date().toISOString() }
    this.peers.set(this.peerKey(userId, deviceId), revoked)
    return revoked
  }
  async findLabSessionByIdempotency(userId: string, key: string) {
    return [...this.sessions.values()].find((item) =>
      item.user_id === userId && item.idempotency_key === key) ?? null
  }
  async getLabSession(userId: string, sessionId: string) {
    const session = this.sessions.get(sessionId)
    return session?.user_id === userId ? session : null
  }
  async createLabSession(session: PersistentLabSession) { this.sessions.set(session.id, { ...session }) }
  async updateLabSession(session: PersistentLabSession) { this.sessions.set(session.id, { ...session }) }
  async getOpenLabSessions(mode: PersistentLabSession['gateway_mode']) {
    return [...this.sessions.values()].filter((session) =>
      session.gateway_mode === mode
      && ['requested', 'authorized', 'connecting', 'connected', 'interrupted', 'stopping'].includes(session.status))
  }
}

const config: ServerConfig = {
  port: 3001,
  supabaseUrl: 'https://project.example.test',
  supabaseAnonKey: 'test-publishable-key',
  allowedOrigins: [],
  wireGuardDevicesEnabled: true,
  wireGuardSessionPersistenceEnabled: true,
  wireGuardDeviceEndpoint: '198.51.100.10:51821',
}

let server: ReturnType<ReturnType<typeof createApp>['listen']>
let baseUrl = ''
let gateway: DeviceGateway
let repository: DeviceRepository

before(async () => {
  gateway = new DeviceGateway()
  repository = new DeviceRepository()
  server = createApp(config, {
    authenticator: new DeviceAuthenticator(),
    deviceGateway: gateway,
    labRepository: repository,
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/devices`
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
})

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
})

test('device peers are unique, owner-scoped, revocable independently, and configuration is public-only', async () => {
  const publicKeyA = Buffer.alloc(32, 11).toString('base64')
  const publicKeyA2 = Buffer.alloc(32, 12).toString('base64')
  const first = await fetch(`${baseUrl}/${deviceA}/wireguard`, {
    method: 'POST', headers: headers('a'), body: JSON.stringify({ public_key: publicKeyA }),
  })
  assert.equal(first.status, 201)
  const firstData = (await first.json()).data
  assert.equal(firstData.peer.public_key, gateway.peers.get(deviceA)?.publicKey)
  assert.equal(JSON.stringify(firstData).includes('private_key'), false)

  const second = await fetch(`${baseUrl}/${deviceA2}/wireguard`, {
    method: 'POST', headers: headers('a'), body: JSON.stringify({ public_key: publicKeyA2 }),
  })
  assert.equal(second.status, 201)
  const secondData = (await second.json()).data
  assert.notEqual(firstData.peer.public_key, secondData.peer.public_key)
  assert.notEqual(firstData.peer.assigned_ip, secondData.peer.assigned_ip)

  const privateKeySubmission = await fetch(`${baseUrl}/${deviceA2}/wireguard`, {
    method: 'POST',
    headers: headers('a'),
    body: JSON.stringify({ public_key: publicKeyA2, private_key: 'must-not-be-accepted' }),
  })
  assert.equal(privateKeySubmission.status, 400)
  assert.equal(JSON.stringify(await privateKeySubmission.json()).includes('must-not-be-accepted'), false)

  const listed = await fetch(`${baseUrl}/wireguard`, { headers: headers('a') })
  assert.equal(listed.status, 200)
  assert.equal((await listed.json()).data.length, 2)
  const otherList = await fetch(`${baseUrl}/wireguard`, { headers: headers('b') })
  assert.deepEqual((await otherList.json()).data, [])

  const crossOwner = await fetch(`${baseUrl}/${deviceA}/wireguard`, { headers: headers('b') })
  assert.equal(crossOwner.status, 404)
  const crossOwnerRevoke = await fetch(`${baseUrl}/${deviceA}/wireguard/revoke`, {
    method: 'POST', headers: headers('b'), body: '{}',
  })
  assert.equal(crossOwnerRevoke.status, 404)

  const configuration = await fetch(`${baseUrl}/${deviceA}/wireguard/configuration`, {
    headers: headers('a'),
  })
  assert.equal(configuration.status, 200)
  const configData = (await configuration.json()).data
  assert.equal(configData.peer_id, firstData.peer.id)
  assert.equal(configData.server_public_key, gateway.peers.get(deviceA)?.serverPublicKey)
  assert.equal(configData.endpoint, '198.51.100.10:51821')
  assert.equal(JSON.stringify(configData).includes('private_key'), false)

  const crossOwnerConfiguration = await fetch(
    `${baseUrl}/${deviceA}/wireguard/configuration`,
    { headers: headers('b') },
  )
  assert.equal(crossOwnerConfiguration.status, 404)

  const peerSessionResponse = await fetch(
    `${baseUrl.replace('/devices', '')}/device-peer-sessions`,
    {
      method: 'POST',
      headers: headers('a'),
      body: JSON.stringify({
        device_id: deviceA,
        idempotency_key: '30000000-0000-4000-8000-000000000001',
      }),
    },
  )
  assert.equal(peerSessionResponse.status, 201)
  const peerSession = (await peerSessionResponse.json()).data
  assert.equal(peerSession.user_id, userA)
  assert.equal(peerSession.device_id, deviceA)
  assert.equal(peerSession.peer_id, firstData.peer.id)
  assert.equal(peerSession.gateway_mode, 'device_peer')
  assert.equal(repository.sessions.get(peerSession.id)?.peer_id, firstData.peer.id)

  const pendingSession = await fetch(
    `${baseUrl.replace('/devices', '')}/device-peer-sessions/${peerSession.id}`,
    { headers: headers('a') },
  )
  assert.equal((await pendingSession.json()).data.status, 'connecting')
  const activePeer = gateway.peers.get(deviceA)!
  gateway.peers.set(deviceA, { ...activePeer, handshakeAt: new Date().toISOString() })
  const connectedSession = await fetch(
    `${baseUrl.replace('/devices', '')}/device-peer-sessions/${peerSession.id}`,
    { headers: headers('a') },
  )
  assert.equal((await connectedSession.json()).data.status, 'connected')

  const crossOwnerSession = await fetch(
    `${baseUrl.replace('/devices', '')}/device-peer-sessions/${peerSession.id}`,
    { headers: headers('b') },
  )
  assert.equal(crossOwnerSession.status, 404)

  const revoked = await fetch(`${baseUrl}/${deviceA}/wireguard/revoke`, {
    method: 'POST', headers: headers('a'), body: '{}',
  })
  assert.equal(revoked.status, 200)
  assert.equal((await revoked.json()).data.status, 'revoked')
  assert.equal(gateway.peers.get(deviceA)?.status, 'revoked')
  assert.equal(gateway.peers.get(deviceA2)?.status, 'active')
})
