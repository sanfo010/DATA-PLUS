import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import type {
  GatewayConnectionConfiguration,
  GatewayObservation,
  WireGuardGateway,
} from './gateway.js'
import { ApiError } from './errors.js'

const execFileAsync = promisify(execFile)
const SCRIPT_NAMES = {
  start: 'setup-wg-lab.sh',
  status: 'status-wg-lab.sh',
  stop: 'stop-wg-lab.sh',
} as const

function toWslPath(path: string): string {
  const resolved = resolve(path)
  const match = resolved.match(/^([A-Za-z]):\\(.*)$/)
  if (!match) {
    throw new Error('The local laboratory script directory must be on a Windows drive.')
  }
  const [, drive, rest] = match
  return `/mnt/${drive.toLowerCase()}/${rest.replaceAll('\\', '/')}`
}

export class LocalWslWireGuardGateway implements WireGuardGateway {
  private readonly scriptDirectory: string

  constructor(scriptDirectory = resolve(process.cwd(), 'scripts')) {
    this.scriptDirectory = toWslPath(scriptDirectory)
  }

  private async runScript(name: keyof typeof SCRIPT_NAMES): Promise<string> {
    const scriptPath = `${this.scriptDirectory}/${SCRIPT_NAMES[name]}`
    try {
      const { stdout } = await execFileAsync(
        'wsl.exe',
        ['--distribution', 'Ubuntu', '--user', 'root', '--', 'bash', scriptPath],
        {
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 64 * 1024,
        },
      )
      return stdout.trim()
    } catch {
      throw new ApiError(
        503,
        'The local WSL WireGuard laboratory could not be controlled.',
        'gateway_unavailable',
      )
    }
  }

  async checkAvailability(): Promise<GatewayObservation> {
    const output = await this.runScript('status')
    const fields = new Map(
      output.split(/\r?\n/).map((line) => {
        const separator = line.indexOf('=')
        return separator < 0
          ? [line, '']
          : [line.slice(0, separator), line.slice(separator + 1)]
      }),
    )
    if (fields.get('available') !== '1') {
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

    const interfaceUp = fields.get('interface_up') === '1'
    const rxBytes = interfaceUp ? this.nonNegativeInteger(fields.get('rx_bytes')) : '0'
    const txBytes = interfaceUp ? this.nonNegativeInteger(fields.get('tx_bytes')) : '0'
    const handshakeSeconds = this.nonNegativeInteger(fields.get('handshake_seconds'))
    const handshakeAt = handshakeSeconds === '0'
      ? null
      : new Date(Number(handshakeSeconds) * 1000).toISOString()
    const handshakeAgeSeconds = handshakeSeconds === '0'
      ? Number.POSITIVE_INFINITY
      : Date.now() / 1000 - Number(handshakeSeconds)
    const status = fields.get('interface_up') !== '1'
      ? 'stopped'
      : handshakeAgeSeconds >= -30 && handshakeAgeSeconds <= 180
        ? 'connected'
        : 'interrupted'

    return {
      available: true,
      status,
      observedAt: new Date().toISOString(),
      rxBytes,
      txBytes,
      totalBytes: (BigInt(rxBytes) + BigInt(txBytes)).toString(),
      handshakeAt,
      peerPublicKey: this.publicKey(fields.get('peer_public_key')),
      serverPublicKey: this.publicKey(fields.get('server_public_key')),
      endpoint: fields.get('endpoint') || null,
    }
  }

  async authorizeDevice(deviceId: string, _sessionId: string): Promise<void> {
    this.requireUuid(deviceId, 'deviceId')
  }

  async createConfiguration(
    deviceId: string,
    _sessionId: string,
  ): Promise<GatewayConnectionConfiguration> {
    this.requireUuid(deviceId, 'deviceId')
    const observation = await this.checkAvailability()
    if (!observation.available || !observation.serverPublicKey || !observation.endpoint) {
      throw new ApiError(503, 'The local WireGuard peer is unavailable.', 'gateway_unavailable')
    }
    return {
      endpoint: observation.endpoint,
      peerPublicKey: observation.serverPublicKey,
      allowedIps: ['10.77.0.1/32'],
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }
  }

  async startSession(sessionId: string): Promise<void> {
    this.requireUuid(sessionId, 'sessionId')
    const result = await this.runScript('start')
    if (result !== 'DATAPLUS_WG_LAB_READY') {
      throw new ApiError(502, 'The local gateway did not confirm lab startup.', 'gateway_invalid_response')
    }
  }

  async getSessionStatus(_sessionId: string): Promise<GatewayObservation> {
    return this.checkAvailability()
  }

  async stopSession(sessionId: string): Promise<void> {
    this.requireUuid(sessionId, 'sessionId')
    const result = await this.runScript('stop')
    if (result !== 'DATAPLUS_WG_LAB_STOPPED') {
      throw new ApiError(502, 'The local gateway did not confirm lab shutdown.', 'gateway_invalid_response')
    }
    const observation = await this.checkAvailability()
    if (observation.status !== 'stopped') {
      throw new ApiError(503, 'The local WireGuard interface is still active.', 'gateway_stop_unconfirmed')
    }
  }

  async revokeDevice(deviceId: string): Promise<void> {
    this.requireUuid(deviceId, 'deviceId')
    throw new ApiError(
      501,
      'The WSL lab uses a shared test peer and cannot revoke an individual WireGuard device.',
      'device_revocation_not_supported',
    )
  }

  private nonNegativeInteger(value: string | undefined): string {
    if (!value || !/^(0|[1-9]\d{0,39})$/.test(value)) {
      throw new ApiError(502, 'The local gateway returned invalid measurement data.', 'gateway_invalid_response')
    }
    return value
  }

  private publicKey(value: string | undefined): string | null {
    return value && /^[A-Za-z0-9+/]{43}=$/.test(value) ? value : null
  }

  private requireUuid(value: string, name: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new ApiError(400, `${name} must be a UUID.`, 'invalid_request')
    }
  }
}
