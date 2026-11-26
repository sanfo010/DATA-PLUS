import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type { DeviceRecord, UserDataService } from '../src/contracts.js'
import { DevicePeerSessionManager } from '../src/device-peer-sessions.js'
import type { DeviceWireGuardGateway, LocalWireGuardPeer } from '../src/gateway-wsl-devices.js'
import type {
  LabRepository,
  NewWireGuardDevicePeer,
  PersistentLabSession,
  WireGuardDevicePeer,
} from '../src/lab-contracts.js'

const userId = '00000000-0000-4000-8000-000000000001'
const deviceId = '10000000-0000-4000-8000-000000000001'
const secondDeviceId = '10000000-0000-4000-8000-000000000002'
const peerId = '20000000-0000-4000-8000-000000000001'
const secondPeerId = '20000000-0000-4000-8000-000000000002'
const publicKey = Buffer.alloc(32, 7).toString('base64')
const secondPublicKey = Buffer.alloc(32, 9).toString('base64')

class PeerRepository implements LabRepository {
  readonly peers = new Map<string, WireGuardDevicePeer>()
  readonly sessions = new Map<string, PersistentLabSession>()

  constructor() {
    this.peers.set(deviceId, {
      id: peerId,
      user_id: userId,
      device_id: deviceId,
      key_version: 1,
      public_key: publicKey,
      assigned_ip: '10.78.0.10',
      status: 'active',
      created_at: new Date().toISOString(),
      revoked_at: null,
    })
    this.peers.set(secondDeviceId, {
      id: secondPeerId,
      user_id: userId,
      device_id: secondDeviceId,
      key_version: 1,
      public_key: secondPublicKey,
      assigned_ip: '10.78.0.11',
      status: 'active',
      created_at: new Date().toISOString(),
      revoked_at: null,
    })
  }

  async createPeer(_peer: NewWireGuardDevicePeer): Promise<WireGuardDevicePeer> {
    throw new Error('not used')
  }
  async getPeer(ownerId: string, id: string) {
    const peer = this.peers.get(id)
    return peer?.user_id === ownerId ? peer : null
  }
  async listPeers() { return [] }
  async revokePeer() { return null }
  async findLabSessionByIdempotency(ownerId: string, key: string) {
    return [...this.sessions.values()].find(
      (session) => session.user_id === ownerId && session.idempotency_key === key,
    ) ?? null
  }
  async getLabSession(ownerId: string, id: string) {
    const session = this.sessions.get(id)
    return session?.user_id === ownerId ? session : null
  }
  async createLabSession(session: PersistentLabSession) {
    this.sessions.set(session.id, { ...session })
  }
  async updateLabSession(session: PersistentLabSession) {
    this.sessions.set(session.id, { ...session })
  }
  async getOpenLabSessions(mode: PersistentLabSession['gateway_mode']) {
    return [...this.sessions.values()].filter(
      (session) => session.gateway_mode === mode
        && !['stopped', 'failed'].includes(session.status),
    )
  }
}

class PeerGateway implements DeviceWireGuardGateway {
  peer: LocalWireGuardPeer = {
    deviceId,
    publicKey,
    assignedIp: '10.78.0.10',
    status: 'active',
    interfaceLoaded: true,
    createdAt: new Date().toISOString(),
    handshakeAt: null,
    rxBytes: '20',
    txBytes: '30',
    serverPublicKey: Buffer.alloc(32, 8).toString('base64'),
    listenPort: 51821,
  }
  secondPeer: LocalWireGuardPeer = {
    ...this.peer,
    deviceId: secondDeviceId,
    publicKey: secondPublicKey,
    assignedIp: '10.78.0.11',
  }
  async enrollPublicKey() { return this.peer }
  async getDeviceStatus(id: string) {
    return id === secondDeviceId ? this.secondPeer : this.peer
  }
  async revokeDevice() {}
}

const data: UserDataService = {
  async getProfile() { return null },
  async listDevices(ownerId): Promise<DeviceRecord[]> {
    return ownerId === userId ? [{
      id: deviceId,
      user_id: userId,
      device_name: 'Peer session test',
      platform: 'android',
      status: 'active',
      created_at: new Date().toISOString(),
      last_seen_at: null,
      revoked_at: null,
    }, {
      id: secondDeviceId,
      user_id: userId,
      device_name: 'Second peer session test',
      platform: 'ios',
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

test('device-peer session restores owner/device/peer and requires a fresh handshake', async () => {
  const repository = new PeerRepository()
  const gateway = new PeerGateway()
  const idempotencyKey = randomUUID()
  const firstProcess = new DevicePeerSessionManager(gateway, repository)
  const created = await firstProcess.start(userId, data, {
    device_id: deviceId,
    idempotency_key: idempotencyKey,
  })

  assert.equal(created.user_id, userId)
  assert.equal(created.device_id, deviceId)
  assert.equal(created.peer_id, peerId)
  assert.equal(created.gateway_mode, 'device_peer')
  assert.equal(created.status, 'connecting')

  const persisted = repository.sessions.get(created.id)
  assert.equal(persisted?.user_id, userId)
  assert.equal(persisted?.device_id, deviceId)
  assert.equal(persisted?.peer_id, peerId)

  const restartedProcess = new DevicePeerSessionManager(gateway, repository)
  const restored = await restartedProcess.get(userId, created.id)
  assert.equal(restored.status, 'interrupted')
  assert.equal(restored.peer_id, peerId)

  gateway.peer = { ...gateway.peer, handshakeAt: new Date().toISOString() }
  const connected = await restartedProcess.get(userId, created.id)
  assert.equal(connected.status, 'connected')
  assert.equal(connected.peer_id, peerId)
  const resumed = await firstProcess.start(userId, data, {
    device_id: deviceId,
    idempotency_key: randomUUID(),
  })
  assert.equal(resumed.id, created.id)
  assert.equal(repository.sessions.size, 1)

  const stopping = await restartedProcess.stop(userId, created.id)
  assert.equal(stopping.status, 'stopping')
  assert.equal(stopping.stopped_at, null)
  const stillConnectedAtGateway = await restartedProcess.get(userId, created.id)
  assert.equal(stillConnectedAtGateway.status, 'stopping')

  gateway.peer = {
    ...gateway.peer,
    handshakeAt: new Date(Date.now() - 181_000).toISOString(),
  }
  const stopped = await restartedProcess.get(userId, created.id)
  assert.equal(stopped.status, 'stopped')
  assert.ok(stopped.stopped_at)
})

test('different devices can hold independent simultaneous device-peer sessions', async () => {
  const repository = new PeerRepository()
  const gateway = new PeerGateway()
  const manager = new DevicePeerSessionManager(gateway, repository)
  const first = await manager.start(userId, data, {
    device_id: deviceId,
    idempotency_key: randomUUID(),
  })
  const second = await manager.start(userId, data, {
    device_id: secondDeviceId,
    idempotency_key: randomUUID(),
  })

  assert.notEqual(first.id, second.id)
  assert.equal(first.device_id, deviceId)
  assert.equal(first.peer_id, peerId)
  assert.equal(second.device_id, secondDeviceId)
  assert.equal(second.peer_id, secondPeerId)
  assert.equal(repository.sessions.size, 2)
})
