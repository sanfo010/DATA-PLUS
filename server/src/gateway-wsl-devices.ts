import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { ApiError } from './errors.js'

const execFileAsync = promisify(execFile)
const wireGuardCounterMax = 18_446_744_073_709_551_615n
const DEVICE_SCRIPTS = {
  setup: 'setup-wg-device-gateway.sh',
  enroll: 'enroll-wg-device.sh',
  status: 'status-wg-device.sh',
  revoke: 'revoke-wg-device.sh',
} as const

export type LocalWireGuardPeer = {
  deviceId: string
  publicKey: string
  assignedIp: string
  status: 'active' | 'revoked'
  interfaceLoaded: boolean
  createdAt: string
  handshakeAt: string | null
  rxBytes: string | null
  txBytes: string | null
  serverPublicKey: string | null
  listenPort: number | null
}

export interface DeviceWireGuardGateway {
  enrollPublicKey(deviceId: string, publicKey: string): Promise<LocalWireGuardPeer>
  getDeviceStatus(deviceId: string): Promise<LocalWireGuardPeer | null>
  revokeDevice(deviceId: string): Promise<void>
}

export class LocalWslDeviceGateway implements DeviceWireGuardGateway {
  private readonly scriptDirectory: string

  constructor(scriptDirectory = resolve(process.cwd(), 'scripts')) {
    const resolved = resolve(scriptDirectory)
    const match = resolved.match(/^([A-Za-z]):\\(.*)$/)
    if (!match) throw new Error('The local laboratory script directory must be on a Windows drive.')
    this.scriptDirectory = `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`
  }

  async ensureReady(): Promise<void> {
    const output = await this.run('setup')
    if (output !== 'DATAPLUS_WG_DEVICE_GATEWAY_READY') {
      throw new ApiError(502, 'The device gateway did not confirm startup.', 'gateway_invalid_response')
    }
  }

  async enrollPublicKey(deviceId: string, publicKey: string): Promise<LocalWireGuardPeer> {
    this.requireUuid(deviceId)
    if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey)) {
      throw new ApiError(400, 'public_key is not a valid WireGuard public key.', 'invalid_request')
    }
    await this.ensureReady()
    const fields = this.parseFields(await this.run('enroll', deviceId, publicKey))
    if (
      fields.get('device_id') !== deviceId
      || fields.get('public_key') !== publicKey
      || fields.get('status') !== 'active'
      || !this.isAssignedIp(fields.get('assigned_ip'))
      || !fields.get('created_at')
    ) {
      throw new ApiError(502, 'The gateway did not confirm native enrollment.', 'gateway_enrollment_unconfirmed')
    }
    const observed = await this.getDeviceStatus(deviceId)
    if (
      !observed
      || observed.status !== 'active'
      || !observed.interfaceLoaded
      || observed.publicKey !== publicKey
      || observed.assignedIp !== fields.get('assigned_ip')
    ) {
      throw new ApiError(502, 'The enrolled gateway peer could not be verified.', 'gateway_peer_unconfirmed')
    }
    return observed
  }

  async getDeviceStatus(deviceId: string): Promise<LocalWireGuardPeer | null> {
    this.requireUuid(deviceId)
    const fields = this.parseFields(await this.run('status', deviceId))
    if (fields.get('found') === '0') return null
    const status = fields.get('status')
    const interfaceLoadedField = fields.get('interface_loaded')
    if (
      fields.get('device_id') !== deviceId
      || (status !== 'active' && status !== 'revoked')
      || (interfaceLoadedField !== '0' && interfaceLoadedField !== '1')
      || !this.isPublicKey(fields.get('public_key'))
      || !this.isAssignedIp(fields.get('assigned_ip'))
      || !fields.get('created_at')
    ) {
      throw new ApiError(502, 'The device gateway returned invalid peer status.', 'gateway_invalid_response')
    }
    const handshakeSeconds = this.integer(fields.get('handshake_seconds'))
    const interfaceLoaded = interfaceLoadedField === '1'
    const rxBytes = interfaceLoaded ? this.integer(fields.get('rx_bytes')) : null
    const txBytes = interfaceLoaded ? this.integer(fields.get('tx_bytes')) : null
    return {
      deviceId,
      publicKey: fields.get('public_key')!,
      assignedIp: fields.get('assigned_ip')!,
      status,
      interfaceLoaded,
      createdAt: fields.get('created_at')!,
      handshakeAt: handshakeSeconds === '0'
        ? null
        : new Date(Number(handshakeSeconds) * 1000).toISOString(),
      rxBytes,
      txBytes,
      serverPublicKey: this.isPublicKey(fields.get('server_public_key'))
        ? fields.get('server_public_key')!
        : null,
      listenPort: this.port(fields.get('listen_port')),
    }
  }

  async revokeDevice(deviceId: string): Promise<void> {
    this.requireUuid(deviceId)
    const result = await this.run('revoke', deviceId)
    if (result !== 'revoked=1' && result !== 'found=0') {
      throw new ApiError(502, 'The device gateway did not confirm revocation.', 'gateway_invalid_response')
    }
  }

  private async run(name: keyof typeof DEVICE_SCRIPTS, ...arguments_: string[]): Promise<string> {
    const scriptPath = `${this.scriptDirectory}/${DEVICE_SCRIPTS[name]}`
    try {
      const { stdout } = await execFileAsync(
        'wsl.exe',
        ['--distribution', 'Ubuntu', '--user', 'root', '--', 'bash', scriptPath, ...arguments_],
        { windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 },
      )
      return stdout.trim()
    } catch {
      throw new ApiError(503, 'The local WSL device gateway could not be controlled.', 'gateway_unavailable')
    }
  }

  private parseFields(output: string): Map<string, string> {
    return new Map(output.split(/\r?\n/).map((line) => {
      const separator = line.indexOf('=')
      return separator < 0
        ? [line, '']
        : [line.slice(0, separator), line.slice(separator + 1)]
    }))
  }

  private integer(value: string | undefined): string {
    if (!value || !/^(0|[1-9]\d{0,39})$/.test(value)) {
      throw new ApiError(502, 'The device gateway returned invalid counters.', 'gateway_invalid_response')
    }
    if (BigInt(value) > wireGuardCounterMax) {
      throw new ApiError(502, 'The device gateway returned an out-of-range counter.', 'gateway_invalid_response')
    }
    return value
  }

  private isPublicKey(value: string | undefined): value is string {
    return Boolean(value && /^[A-Za-z0-9+/]{43}=$/.test(value))
  }

  private isAssignedIp(value: string | undefined): value is string {
    return Boolean(value && /^10\.78\.0\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4])$/.test(value))
  }

  private port(value: string | undefined): number | null {
    if (!value || !/^[1-9]\d{0,4}$/.test(value)) return null
    const port = Number(value)
    return port <= 65535 ? port : null
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  }

  private requireUuid(value: string): void {
    if (!this.isUuid(value)) throw new ApiError(400, 'deviceId must be a UUID.', 'invalid_request')
  }
}
