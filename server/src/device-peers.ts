import { randomUUID } from 'node:crypto'
import type { UserDataService } from './contracts.js'
import { ApiError, notFound } from './errors.js'
import type {
  DeviceWireGuardGateway,
  LocalWireGuardPeer,
} from './gateway-wsl-devices.js'
import type { LabRepository, WireGuardDevicePeer } from './lab-contracts.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class DevicePeerManager {
  constructor(
    private readonly gateway: DeviceWireGuardGateway,
    private readonly repository: LabRepository,
    private readonly clientEndpoint?: string,
  ) {}

  async list(userId: string): Promise<WireGuardDevicePeer[]> {
    return this.repository.listPeers(userId)
  }

  async get(
    userId: string,
    data: UserDataService,
    deviceId: string,
  ): Promise<{ peer: WireGuardDevicePeer | null; gateway: LocalWireGuardPeer | null }> {
    await this.requireOwnedActiveDevice(userId, data, deviceId)
    const peer = await this.repository.getPeer(userId, deviceId)
    if (!peer) return { peer: null, gateway: null }
    const observation = await this.gateway.getDeviceStatus(deviceId)
    if (observation && observation.publicKey !== peer.public_key) {
      throw new ApiError(502, 'The gateway peer does not match the stored public identity.', 'gateway_identity_mismatch')
    }
    return { peer: this.publicPeer(peer), gateway: observation }
  }

  async getConfiguration(
    userId: string,
    data: UserDataService,
    deviceId: string,
  ): Promise<{
    peer_id: string
    address: string
    server_public_key: string
    endpoint: string
    allowed_ips: string[]
  }> {
    await this.requireOwnedActiveDevice(userId, data, deviceId)
    if (!this.clientEndpoint) {
      throw new ApiError(503, 'The WireGuard device endpoint is not configured.', 'device_endpoint_unavailable')
    }
    const peer = await this.repository.getPeer(userId, deviceId)
    if (!peer || peer.status !== 'active') throw notFound('Active WireGuard peer not found for this device.')
    const observation = await this.gateway.getDeviceStatus(deviceId)
    if (
      !observation
      || observation.status !== 'active'
      || !observation.interfaceLoaded
      || observation.publicKey !== peer.public_key
      || observation.assignedIp !== peer.assigned_ip
      || !observation.serverPublicKey
      || !observation.listenPort
    ) {
      throw new ApiError(503, 'The active WireGuard peer configuration is unavailable.', 'device_configuration_unavailable')
    }
    const configuredPort = Number(this.clientEndpoint.slice(this.clientEndpoint.lastIndexOf(':') + 1))
    if (configuredPort !== observation.listenPort) {
      throw new ApiError(503, 'The configured WireGuard endpoint port does not match the gateway.', 'device_endpoint_mismatch')
    }
    return {
      peer_id: peer.id,
      address: `${peer.assigned_ip}/32`,
      server_public_key: observation.serverPublicKey,
      endpoint: this.clientEndpoint,
      allowed_ips: ['10.78.0.0/24'],
    }
  }

  async provision(
    _userId: string,
    _data: UserDataService,
    _deviceId: string,
  ): Promise<{ peer: WireGuardDevicePeer; gateway: LocalWireGuardPeer }> {
    throw new ApiError(
      501,
      'Web provisioning is disabled; a native device must submit its public WireGuard key.',
      'native_enrollment_required',
    )
  }

  async enroll(
    userId: string,
    data: UserDataService,
    deviceId: string,
    publicKey: string,
  ): Promise<{ peer: WireGuardDevicePeer; gateway: LocalWireGuardPeer }> {
    await this.requireOwnedActiveDevice(userId, data, deviceId)
    if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey)) {
      throw new ApiError(400, 'public_key is not a valid WireGuard public key.', 'invalid_request')
    }
    const previous = await this.repository.getPeer(userId, deviceId)
    if (previous?.status === 'revoked') {
      throw new ApiError(409, 'This device identity was revoked; key rotation must be completed before reprovisioning.', 'peer_revoked')
    }

    if (previous) {
      const storedIdentity = await this.gateway.getDeviceStatus(deviceId)
      if (!storedIdentity || storedIdentity.publicKey !== previous.public_key) {
        throw new ApiError(409, 'The stored device identity is missing from the local key store; manual recovery is required.', 'peer_identity_missing')
      }
    }
    const gatewayPeer = await this.gateway.enrollPublicKey(deviceId, publicKey)
    if (previous && (previous.public_key !== publicKey || previous.public_key !== gatewayPeer.publicKey)) {
      throw new ApiError(502, 'The gateway peer does not match the stored public identity.', 'gateway_identity_mismatch')
    }
    let peer = previous
    if (!peer) {
      try {
        peer = await this.repository.createPeer({
          id: randomUUID(),
          user_id: userId,
          device_id: deviceId,
          key_version: 1,
          public_key: gatewayPeer.publicKey,
          assigned_ip: gatewayPeer.assignedIp,
          status: 'active',
        })
      } catch (error) {
        const concurrentPeer = await this.repository.getPeer(userId, deviceId)
        if (
          !concurrentPeer
          || concurrentPeer.status !== 'active'
          || concurrentPeer.public_key !== gatewayPeer.publicKey
          || concurrentPeer.assigned_ip !== gatewayPeer.assignedIp
        ) {
          throw error
        }
        peer = concurrentPeer
      }
    }
    if (
      peer.public_key !== gatewayPeer.publicKey
      || peer.assigned_ip !== gatewayPeer.assignedIp
      || peer.status !== 'active'
    ) {
      throw new ApiError(502, 'The gateway peer does not match the stored device identity.', 'gateway_identity_mismatch')
    }
    return { peer: this.publicPeer(peer), gateway: gatewayPeer }
  }

  async revoke(userId: string, data: UserDataService, deviceId: string): Promise<WireGuardDevicePeer> {
    await this.requireOwnedDevice(userId, data, deviceId)
    const peer = await this.repository.getPeer(userId, deviceId)
    if (!peer) throw notFound('WireGuard peer not found for this device.')
    return this.revokePeer(userId, deviceId, peer)
  }

  async revokeOnDeviceRemoval(userId: string, data: UserDataService, deviceId: string): Promise<void> {
    await this.requireOwnedDevice(userId, data, deviceId)
    const peer = await this.repository.getPeer(userId, deviceId)
    if (!peer || peer.status === 'revoked') return
    await this.revokePeer(userId, deviceId, peer)
  }

  private async revokePeer(
    userId: string,
    deviceId: string,
    peer: WireGuardDevicePeer,
  ): Promise<WireGuardDevicePeer> {
    if (peer.status === 'revoked') return this.publicPeer(peer)

    await this.gateway.revokeDevice(deviceId)
    const observed = await this.gateway.getDeviceStatus(deviceId)
    if (observed?.status !== 'revoked') {
      throw new ApiError(503, 'The gateway did not confirm device peer revocation.', 'gateway_revoke_unconfirmed')
    }
    const revoked = await this.repository.revokePeer(userId, deviceId)
    if (!revoked) {
      throw new ApiError(409, 'The stored device peer changed during revocation.', 'peer_state_conflict')
    }
    return this.publicPeer(revoked)
  }

  private async requireOwnedActiveDevice(
    userId: string,
    data: UserDataService,
    deviceId: string,
  ): Promise<void> {
    const device = await this.requireOwnedDevice(userId, data, deviceId)
    if (device.status !== 'active') throw notFound('Active account device not found.')
  }

  private async requireOwnedDevice(userId: string, data: UserDataService, deviceId: string) {
    if (!uuidPattern.test(deviceId)) throw new ApiError(400, 'deviceId must be a UUID.', 'invalid_request')
    const device = (await data.listDevices(userId)).find((candidate) => candidate.id === deviceId)
    if (!device) throw notFound('Account device not found.')
    return device
  }

  private publicPeer(peer: WireGuardDevicePeer): WireGuardDevicePeer {
    return { ...peer }
  }
}
