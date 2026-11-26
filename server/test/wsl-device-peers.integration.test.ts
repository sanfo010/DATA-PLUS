import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { LocalWslDeviceGateway } from '../src/gateway-wsl-devices.js'

const execFileAsync = promisify(execFile)
const enabled = process.env.DATAPLUS_WG_DEVICE_INTEGRATION_TEST === '1'

test('WSL enrolls distinct native device peers and revokes only the selected peer', { skip: !enabled }, async () => {
  const gateway = new LocalWslDeviceGateway()
  const scriptDir = resolve(process.cwd(), 'scripts').replace(/^([A-Za-z]):\\/, (_, drive: string) =>
    `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/')
  const one = randomUUID()
  const two = randomUUID()
  let gatewayWasPresent = false

  try {
    try {
      await execFileAsync('wsl.exe', [
        '--distribution', 'Ubuntu', '--', 'ip', 'link', 'show', 'dev', 'wgdpdev0',
      ], { windowsHide: true })
      gatewayWasPresent = true
    } catch {
      gatewayWasPresent = false
    }

    await gateway.ensureReady()
    const publicKeyOne = Buffer.alloc(32, 21).toString('base64')
    const publicKeyTwo = Buffer.alloc(32, 22).toString('base64')
    const first = await gateway.enrollPublicKey(one, publicKeyOne)
    const second = await gateway.enrollPublicKey(two, publicKeyTwo)
    assert.notEqual(first.publicKey, second.publicKey)
    assert.notEqual(first.assignedIp, second.assignedIp)
    assert.equal(first.status, 'active')
    assert.equal(second.status, 'active')
    assert.equal(first.interfaceLoaded, true)
    assert.equal(second.interfaceLoaded, true)
    for (const id of [one, two]) {
      const peerDirectory = `/root/dataplus-lab/devices/peers/${id}`
      const directoryMode = await execFileAsync('wsl.exe', [
        '--distribution', 'Ubuntu', '--user', 'root', '--', 'stat', '-c', '%a', peerDirectory,
      ], { windowsHide: true })
      assert.equal(directoryMode.stdout.trim(), '700')
      assert.equal(await (async () => {
        try {
          await execFileAsync('wsl.exe', [
            '--distribution', 'Ubuntu', '--user', 'root', '--', 'test', '-e', `${peerDirectory}/private.key`,
          ], { windowsHide: true })
          return true
        } catch {
          return false
        }
      })(), false)
    }

    await gateway.revokeDevice(one)
    assert.equal((await gateway.getDeviceStatus(one))?.status, 'revoked')
    assert.equal((await gateway.getDeviceStatus(two))?.status, 'active')
  } finally {
    for (const id of [one, two]) {
      await execFileAsync('wsl.exe', [
        '--distribution', 'Ubuntu', '--user', 'root', '--', 'bash',
        `${scriptDir}/cleanup-wg-device-test-peer.sh`, id,
      ], { windowsHide: true })
    }
    if (!gatewayWasPresent) {
      const { stdout } = await execFileAsync('wsl.exe', [
        '--distribution', 'Ubuntu', '--user', 'root', '--', 'bash', `${scriptDir}/stop-wg-device-gateway.sh`,
      ], { windowsHide: true })
      assert.equal(stdout.trim(), 'DATAPLUS_WG_DEVICE_GATEWAY_STOPPED')
    }
  }
})
