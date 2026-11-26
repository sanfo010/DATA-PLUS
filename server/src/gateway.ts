import { ApiError } from './errors.js'

export type GatewayConnectionConfiguration = {
  endpoint: string
  peerPublicKey: string
  allowedIps: string[]
  expiresAt: string
}

export type GatewayObservation = {
  available: boolean
  status: 'connected' | 'interrupted' | 'stopped' | 'unavailable'
  observedAt: string
  rxBytes: string | null
  txBytes: string | null
  totalBytes: string | null
  handshakeAt: string | null
  peerPublicKey: string | null
  serverPublicKey: string | null
  endpoint: string | null
}

export interface WireGuardGateway {
  checkAvailability(): Promise<GatewayObservation>
  authorizeDevice(deviceId: string, sessionId: string): Promise<void>
  createConfiguration(deviceId: string, sessionId: string): Promise<GatewayConnectionConfiguration>
  startSession(sessionId: string): Promise<void>
  getSessionStatus(sessionId: string): Promise<GatewayObservation>
  stopSession(sessionId: string): Promise<void>
  revokeDevice(deviceId: string): Promise<void>
}

export class UnconfiguredWireGuardGateway implements WireGuardGateway {
  private unavailable(): never {
    throw new ApiError(503, 'No WireGuard gateway is configured.', 'gateway_unavailable')
  }

  async checkAvailability(): Promise<GatewayObservation> {
    this.unavailable()
  }

  async authorizeDevice(_deviceId: string, _sessionId: string): Promise<void> {
    this.unavailable()
  }

  async createConfiguration(
    _deviceId: string,
    _sessionId: string,
  ): Promise<GatewayConnectionConfiguration> {
    return this.unavailable()
  }

  async startSession(_sessionId: string): Promise<void> {
    this.unavailable()
  }

  async getSessionStatus(_sessionId: string): Promise<GatewayObservation> {
    return this.unavailable()
  }

  async stopSession(_sessionId: string): Promise<void> {
    this.unavailable()
  }

  async revokeDevice(_deviceId: string): Promise<void> {
    this.unavailable()
  }
}
