import { fork } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const scriptPath = fileURLToPath(import.meta.url)
const expectedProjectHost = 'epmcynygxvywdnvjnxan.supabase.co'
const testPort = 3012
const testBaseUrl = `http://127.0.0.1:${testPort}`
const confirmation = 'I_CONFIRM_THIS_IS_STAGING'
const openStatuses = [
  'requested',
  'authorized',
  'connecting',
  'connected',
  'interrupted',
  'stopping',
]
const authOptions = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
}

if (process.argv[2] === '--backend-child') {
  const { createApp } = await import('../server/src/app.ts')
  const { loadConfig } = await import('../server/src/config.ts')

  try {
    const config = loadConfig()
    const server = createApp(config).listen(config.port, '127.0.0.1', () => {
      process.send?.({ type: 'ready' })
    })
    process.on('message', (message) => {
      if (message?.type !== 'shutdown') return
      server.close((error) => {
        process.send?.({ type: 'stopped', ok: !error })
        if (error) process.exitCode = 1
        process.disconnect?.()
      })
    })
  } catch {
    process.send?.({ type: 'startup-failed' }, () => {
      process.exitCode = 1
      process.disconnect?.()
    })
  }
} else {
  let phase = 'preflight'
  let child
  let testDeviceId
  let testPeerId
  let testSessionId
  let ownerUserId
  let ownerApiToken
  let otherApiToken
  let ownerClient
  let otherClient
  let deviceRevoked = false
  let sessionStopped = false
  let gatewayTouched = false
  const gatewayWasPresent = false
  const readyChildren = new WeakSet()

  function requireCondition(condition, code) {
    if (condition) return
    const error = new Error()
    error.safeCode = code
    throw error
  }

  function parseEnvFile(path) {
    if (!existsSync(path)) return {}
    const parsed = {}
    const lines = readFileSync(path, 'utf8').split(/\r?\n/)
    for (const [index, rawLine] of lines.entries()) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z\d_]*)\s*=\s*(.*)$/)
      if (!match) {
        const error = new Error()
        error.safeCode = `INVALID_ENV_LINE_${index + 1}`
        throw error
      }
      const [, name, rawValue] = match
      parsed[name] = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2')
    }
    return parsed
  }

  function getValue(name, fileValues) {
    return process.env[name] || fileValues[name] || ''
  }

  function stagingConfig() {
    requireCondition(
      process.argv.includes('--confirm-staging-writes'),
      'STAGING_WRITE_CONFIRMATION_MISSING',
    )
    requireCondition(
      process.argv.includes('--confirm-no-open-device-peer-sessions'),
      'OPEN_DEVICE_PEER_SESSION_PREFLIGHT_MISSING',
    )
    requireCondition(
      process.argv.includes('--retain-test-rows'),
      'TEST_ROW_RETENTION_CONFIRMATION_MISSING',
    )
    const fileValues = parseEnvFile(resolve(process.cwd(), '.env.staging.local'))
    const required = [
      'DATAPLUS_STAGING_URL',
      'DATAPLUS_STAGING_ANON_KEY',
      'DATAPLUS_STAGING_USER_A_EMAIL',
      'DATAPLUS_STAGING_USER_A_PASSWORD',
      'DATAPLUS_STAGING_USER_B_EMAIL',
      'DATAPLUS_STAGING_USER_B_PASSWORD',
      'DATAPLUS_STAGING_CONFIRM_WRITES',
    ]
    requireCondition(
      required.every((name) => getValue(name, fileValues)),
      'STAGING_CONFIG_INCOMPLETE',
    )

    const config = Object.fromEntries(
      required.map((name) => [name, getValue(name, fileValues)]),
    )
    const target = new URL(config.DATAPLUS_STAGING_URL)
    requireCondition(
      config.DATAPLUS_STAGING_CONFIRM_WRITES === confirmation,
      'STAGING_WRITE_CONFIRMATION_MISSING',
    )
    requireCondition(
      target.protocol === 'https:' && target.host === expectedProjectHost,
      'STAGING_TARGET_MISMATCH',
    )
    requireCondition(
      new URL(process.env.SUPABASE_URL).origin === target.origin,
      'BACKEND_URL_NOT_STAGING',
    )
    requireCondition(
      process.env.SUPABASE_ANON_KEY === config.DATAPLUS_STAGING_ANON_KEY,
      'BACKEND_ANON_KEY_MISMATCH',
    )
    requireCondition(
      Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
      'BACKEND_SERVICE_ROLE_MISSING',
    )
    requireCondition(
      process.env.DATAPLUS_WG_LAB_ENABLED === '1'
        && process.env.DATAPLUS_WG_DEVICES_ENABLED === '1'
        && process.env.DATAPLUS_WG_SESSION_PERSISTENCE === '1',
      'BACKEND_LAB_FLAGS_NOT_ENABLED',
    )
    requireCondition(process.env.NODE_ENV !== 'production', 'PRODUCTION_ENVIRONMENT_REFUSED')

    const frontendEnv = resolve(process.cwd(), '.env.local')
    if (existsSync(frontendEnv)) {
      const frontend = readFileSync(frontendEnv, 'utf8')
      const frontendUrl = frontend.match(/^\s*VITE_SUPABASE_URL\s*=\s*(.+)\s*$/m)?.[1]
        ?.trim()
        .replace(/^(['"])(.*)\1$/, '$2')
      requireCondition(
        !frontendUrl || new URL(frontendUrl).origin !== target.origin,
        'STAGING_MATCHES_FRONTEND_PROJECT',
      )
    }
    return {
      url: target.origin,
      anonKey: config.DATAPLUS_STAGING_ANON_KEY,
      ownerEmail: config.DATAPLUS_STAGING_USER_A_EMAIL,
      ownerPassword: config.DATAPLUS_STAGING_USER_A_PASSWORD,
      otherEmail: config.DATAPLUS_STAGING_USER_B_EMAIL,
      otherPassword: config.DATAPLUS_STAGING_USER_B_PASSWORD,
    }
  }

  function backendEnvironment() {
    const names = [
      'PATH',
      'PATHEXT',
      'SystemRoot',
      'WINDIR',
      'SystemDrive',
      'USERPROFILE',
      'TEMP',
      'TMP',
      'APPDATA',
      'LOCALAPPDATA',
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'DATAPLUS_WG_LAB_ENABLED',
      'DATAPLUS_WG_DEVICES_ENABLED',
      'DATAPLUS_WG_SESSION_PERSISTENCE',
      'CORS_ORIGINS',
    ]
    const environment = {}
    for (const name of names) {
      if (process.env[name] !== undefined) environment[name] = process.env[name]
    }
    environment.NODE_ENV = 'development'
    environment.PORT = String(testPort)
    environment.DATAPLUS_WG_DEVICE_ENDPOINT = '127.0.0.1:51821'
    return environment
  }

  async function verifyPortAvailable() {
    const server = createServer()
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(testPort, '127.0.0.1', () => {
        server.close((error) => error ? rejectListen(error) : resolveListen())
      })
    })
  }

  async function runWslRoot(args) {
    const { stdout } = await execFileAsync(
      'wsl.exe',
      ['--distribution', 'Ubuntu', '--user', 'root', '--', ...args],
      { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 },
    )
    return stdout.trim()
  }

  async function verifySafeWslPreconditions() {
    const links = JSON.parse(await runWslRoot(['ip', '-j', 'link', 'show']))
    requireCondition(
      !links.some((item) => item.ifname === 'wgdpdev0'),
      'WSL_DEVICE_GATEWAY_ALREADY_RUNNING',
    )
    const peerDirectoryCount = await runWslRoot([
      'bash',
      '-lc',
      'find /root/dataplus-lab/devices/peers -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l',
    ])
    requireCondition(peerDirectoryCount === '0', 'WSL_PEER_TEST_DATA_ALREADY_PRESENT')
  }

  async function verifySchemaAndNoOpenSessions(adminClient) {
    const peerSchema = await adminClient
      .from('wireguard_device_peers')
      .select('id,user_id,device_id,key_version,public_key,assigned_ip,status')
      .limit(0)
    const sessionSchema = await adminClient
      .from('vpn_lab_sessions')
      .select('id,user_id,device_id,peer_id,gateway_mode,status')
      .limit(0)
    requireCondition(!peerSchema.error, 'DEVICE_PEER_SCHEMA_NOT_READY')
    requireCondition(!sessionSchema.error, 'DEVICE_PEER_SESSION_SCHEMA_NOT_READY')
    const open = await adminClient
      .from('vpn_lab_sessions')
      .select('id')
      .eq('gateway_mode', 'device_peer')
      .in('status', openStatuses)
    requireCondition(!open.error, 'OPEN_SESSION_PREFLIGHT_FAILED')
    requireCondition(open.data.length === 0, 'EXISTING_DEVICE_PEER_SESSIONS_PRESENT')
  }

  async function signIn(url, anonKey, email, password) {
    const authClient = createClient(url, anonKey, authOptions)
    const { data, error } = await authClient.auth.signInWithPassword({ email, password })
    requireCondition(
      !error && data.user && data.session?.access_token,
      'STAGING_AUTH_FAILED',
    )
    const client = createClient(url, anonKey, {
      ...authOptions,
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    })
    return {
      userId: data.user.id,
      accessToken: data.session.access_token,
      client,
    }
  }

  async function startBackend() {
    return new Promise((resolveStart, rejectStart) => {
      let settled = false
      const processChild = fork(scriptPath, ['--backend-child'], {
        cwd: process.cwd(),
        execArgv: ['--import', 'tsx'],
        env: backendEnvironment(),
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      })
      child = processChild
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        const error = new Error()
        error.safeCode = 'BACKEND_START_TIMEOUT'
        rejectStart(error)
        if (processChild.connected) processChild.send({ type: 'shutdown' }, () => {})
      }, 30_000)
      processChild.on('message', (message) => {
        if (settled) return
        if (message?.type === 'ready') {
          settled = true
          readyChildren.add(processChild)
          clearTimeout(timeout)
          resolveStart(processChild)
        } else if (message?.type === 'startup-failed') {
          settled = true
          clearTimeout(timeout)
          const error = new Error()
          error.safeCode = 'BACKEND_START_FAILED'
          rejectStart(error)
        }
      })
      processChild.once('error', () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        const error = new Error()
        error.safeCode = 'BACKEND_PROCESS_ERROR'
        rejectStart(error)
      })
      processChild.once('exit', () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        const error = new Error()
        error.safeCode = 'BACKEND_EXITED_BEFORE_READY'
        rejectStart(error)
      })
    })
  }

  async function stopBackend(processChild) {
    if (!processChild || processChild.exitCode !== null) return
    await new Promise((resolveStop, rejectStop) => {
      const timeout = setTimeout(() => {
        const error = new Error()
        error.safeCode = 'BACKEND_GRACEFUL_STOP_TIMEOUT'
        rejectStop(error)
      }, 20_000)
      processChild.once('exit', (code) => {
        clearTimeout(timeout)
        if (code === 0 || !readyChildren.has(processChild)) resolveStop()
        else {
          const error = new Error()
          error.safeCode = 'BACKEND_GRACEFUL_STOP_FAILED'
          rejectStop(error)
        }
      })
      processChild.send({ type: 'shutdown' }, (error) => {
        if (!error) return
        clearTimeout(timeout)
        const stopError = new Error()
        stopError.safeCode = 'BACKEND_SHUTDOWN_SIGNAL_FAILED'
        rejectStop(stopError)
      })
    })
  }

  async function request(path, token, method = 'GET', body, timeoutMs = 15_000) {
    const response = await fetch(`${testBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    let payload
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    return { status: response.status, payload }
  }

  async function selectOwnRow(client, table, columns, key, value) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .eq(key, value)
      .maybeSingle()
    requireCondition(!error, `STAGING_RLS_READ_FAILED_${table.toUpperCase()}`)
    return data
  }

  function requireWriteDenied(result, code) {
    requireCondition(
      Boolean(result.error) || !result.data || result.data.length === 0,
      code,
    )
  }

  async function cleanup() {
    if (
      testDeviceId
      && ownerApiToken
      && (!sessionStopped || !deviceRevoked)
      && (!child || child.exitCode !== null)
    ) {
      try {
        await startBackend()
      } catch {
        process.exitCode = 1
      }
    }
    if (child && child.exitCode === null) {
      if (testSessionId && !sessionStopped && ownerApiToken) {
        try {
          const stopped = await request(
            `/api/v1/device-peer-sessions/${testSessionId}/stop`,
            ownerApiToken,
            'POST',
            {},
          )
          sessionStopped = stopped.status === 200
            && stopped.payload?.data?.status === 'stopped'
        } catch {
          sessionStopped = false
        }
      }
      if (testDeviceId && !deviceRevoked && ownerApiToken) {
        try {
          const revoked = await request(
            `/api/v1/devices/${testDeviceId}/revoke`,
            ownerApiToken,
            'POST',
            {},
          )
          deviceRevoked = revoked.status === 200
            && revoked.payload?.data?.status === 'revoked'
        } catch {
          deviceRevoked = false
        }
      }
      try {
        await stopBackend(child)
      } catch {
        process.exitCode = 1
      }
      child = undefined
    }
    if (testDeviceId) {
      try {
        const scripts = resolve(process.cwd(), 'scripts')
        const match = scripts.match(/^([A-Za-z]):\\(.*)$/)
        requireCondition(Boolean(match), 'WSL_SCRIPT_PATH_INVALID')
        const [, drive, rest] = match
        const cleanupScript = `/mnt/${drive.toLowerCase()}/${rest.replaceAll('\\', '/')}/cleanup-wg-device-test-peer.sh`
        await execFileAsync('wsl.exe', [
          '--distribution',
          'Ubuntu',
          '--user',
          'root',
          '--',
          'bash',
          cleanupScript,
          testDeviceId,
        ], { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 })
      } catch {
        process.exitCode = 1
      }
    }
    if (gatewayTouched && !gatewayWasPresent) {
      try {
        const scripts = resolve(process.cwd(), 'scripts')
        const match = scripts.match(/^([A-Za-z]):\\(.*)$/)
        requireCondition(Boolean(match), 'WSL_SCRIPT_PATH_INVALID')
        const [, drive, rest] = match
        const stopScript = `/mnt/${drive.toLowerCase()}/${rest.replaceAll('\\', '/')}/stop-wg-device-gateway.sh`
        const { stdout } = await execFileAsync('wsl.exe', [
          '--distribution',
          'Ubuntu',
          '--user',
          'root',
          '--',
          'bash',
          stopScript,
        ], { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 })
        requireCondition(
          stdout.trim() === 'DATAPLUS_WG_DEVICE_GATEWAY_STOPPED',
          'WSL_GATEWAY_STOP_NOT_CONFIRMED',
        )
      } catch {
        process.exitCode = 1
      }
    }
    if (testSessionId && !sessionStopped) {
      console.error('FAIL cleanup TEST_SESSION_STOP_NOT_CONFIRMED')
      process.exitCode = 1
    }
    if (testDeviceId && !deviceRevoked) {
      console.error('FAIL cleanup TEST_DEVICE_REVOCATION_NOT_CONFIRMED')
      process.exitCode = 1
    }
  }

  async function run() {
    const staging = stagingConfig()
    await verifyPortAvailable()
    await verifySafeWslPreconditions()

    const adminClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      authOptions,
    )
    await verifySchemaAndNoOpenSessions(adminClient)
    console.log('PASS staging target, schema, RLS read preflight, and no open device-peer sessions')

    const owner = await signIn(
      staging.url,
      staging.anonKey,
      staging.ownerEmail,
      staging.ownerPassword,
    )
    const other = await signIn(
      staging.url,
      staging.anonKey,
      staging.otherEmail,
      staging.otherPassword,
    )
    requireCondition(owner.userId !== other.userId, 'STAGING_TEST_USERS_NOT_DISTINCT')
    ownerUserId = owner.userId
    ownerApiToken = owner.accessToken
    otherApiToken = other.accessToken
    ownerClient = owner.client
    otherClient = other.client
    staging.ownerEmail = ''
    staging.ownerPassword = ''
    staging.otherEmail = ''
    staging.otherPassword = ''
    console.log('PASS two distinct staging test accounts authenticated')

    await startBackend()
    const health = await fetch(`${testBaseUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    })
    requireCondition(health.ok, 'BACKEND_HEALTH_FAILED')
    const capabilitiesResponse = await fetch(`${testBaseUrl}/api/v1/capabilities`, {
      signal: AbortSignal.timeout(5_000),
    })
    const capabilities = await capabilitiesResponse.json()
    requireCondition(
      capabilitiesResponse.ok
        && capabilities.data?.devicePeers === 'enabled'
        && capabilities.data?.labSessionPersistence === 'enabled',
      'BACKEND_CAPABILITIES_MISMATCH',
    )
    console.log('PASS isolated backend started on loopback with service-role persistence')

    phase = 'device-registration'
    const deviceName = `PHASE9-DEVICE-PEER-${randomUUID().slice(0, 8)}`
    const registration = await request('/api/v1/devices', ownerApiToken, 'POST', {
      device_name: deviceName,
      platform: 'android',
      idempotency_key: randomUUID(),
    })
    requireCondition(registration.status === 201, 'TEST_DEVICE_REGISTRATION_FAILED')
    testDeviceId = registration.payload?.data?.id
    requireCondition(
      typeof testDeviceId === 'string'
        && registration.payload?.data?.user_id === ownerUserId,
      'TEST_DEVICE_OWNER_MISMATCH',
    )

    phase = 'public-key-only-enrollment'
    gatewayTouched = true
    const publicKey = randomBytes(32).toString('base64')
    requireCondition(/^[A-Za-z0-9+/]{43}=$/.test(publicKey), 'TEST_PUBLIC_KEY_INVALID')
    const enrollment = await request(
      `/api/v1/devices/${testDeviceId}/wireguard`,
      ownerApiToken,
      'POST',
      { public_key: publicKey },
    )
    requireCondition(enrollment.status === 201, 'TEST_DEVICE_PEER_ENROLLMENT_FAILED')
    const enrolledPeer = enrollment.payload?.data?.peer
    testPeerId = enrolledPeer?.id
    requireCondition(
      typeof testPeerId === 'string'
        && enrolledPeer?.user_id === ownerUserId
        && enrolledPeer?.device_id === testDeviceId
        && enrolledPeer?.public_key === publicKey
        && enrolledPeer?.status === 'active',
      'TEST_DEVICE_PEER_ASSOCIATION_MISMATCH',
    )
    const peerRow = await selectOwnRow(
      ownerClient,
      'wireguard_device_peers',
      '*',
      'id',
      testPeerId,
    )
    requireCondition(
      peerRow?.user_id === ownerUserId
        && peerRow.device_id === testDeviceId
        && peerRow.public_key === publicKey
        && peerRow.status === 'active'
        && !Object.keys(peerRow).some((key) => /private|secret/i.test(key)),
      'TEST_PEER_STAGING_ROW_MISMATCH',
    )
    const hiddenPeer = await selectOwnRow(
      otherClient,
      'wireguard_device_peers',
      'id',
      'id',
      testPeerId,
    )
    requireCondition(hiddenPeer === null, 'CROSS_OWNER_PEER_READ_SUCCEEDED')
    const foreignPeerApi = await request(
      `/api/v1/devices/${testDeviceId}/wireguard/configuration`,
      otherApiToken,
    )
    requireCondition(foreignPeerApi.status === 404, 'CROSS_OWNER_DEVICE_API_READ_SUCCEEDED')
    console.log(`PASS public-key-only peer persisted and isolated (${testPeerId})`)

    const directPeerUpdate = await ownerClient
      .from('wireguard_device_peers')
      .update({ status: 'active' })
      .eq('id', testPeerId)
      .select('id')
    requireWriteDenied(directPeerUpdate, 'DIRECT_PEER_WRITE_ALLOWED')
    console.log('PASS authenticated direct peer writes are denied')

    const configuration = await request(
      `/api/v1/devices/${testDeviceId}/wireguard/configuration`,
      ownerApiToken,
    )
    const configurationData = configuration.payload?.data
    requireCondition(
      configuration.status === 200
        && configurationData?.peer_id === testPeerId
        && configurationData?.endpoint === '127.0.0.1:51821'
        && Array.isArray(configurationData?.allowed_ips)
        && !Object.keys(configurationData).some((key) => /private|secret/i.test(key)),
      'TEST_DEVICE_CONFIGURATION_INVALID',
    )
    console.log('PASS authenticated configuration contains only public tunnel parameters')

    phase = 'device-peer-session-create'
    const sessionResponse = await request('/api/v1/device-peer-sessions', ownerApiToken, 'POST', {
      device_id: testDeviceId,
      idempotency_key: randomUUID(),
    })
    requireCondition(
      sessionResponse.status === 201
        && sessionResponse.payload?.data?.status === 'connecting',
      'TEST_DEVICE_PEER_SESSION_CREATE_FAILED',
    )
    testSessionId = sessionResponse.payload?.data?.id
    requireCondition(
      typeof testSessionId === 'string'
        && sessionResponse.payload?.data?.user_id === ownerUserId
        && sessionResponse.payload?.data?.device_id === testDeviceId
        && sessionResponse.payload?.data?.peer_id === testPeerId
        && sessionResponse.payload?.data?.gateway_mode === 'device_peer',
      'TEST_DEVICE_PEER_SESSION_ASSOCIATION_MISMATCH',
    )
    const sessionRow = await selectOwnRow(
      ownerClient,
      'vpn_lab_sessions',
      'id,user_id,device_id,peer_id,gateway_mode,status',
      'id',
      testSessionId,
    )
    requireCondition(
      sessionRow?.user_id === ownerUserId
        && sessionRow.device_id === testDeviceId
        && sessionRow.peer_id === testPeerId
        && sessionRow.gateway_mode === 'device_peer'
        && sessionRow.status === 'connecting',
      'TEST_DEVICE_PEER_SESSION_ROW_MISMATCH',
    )
    const hiddenSession = await selectOwnRow(
      otherClient,
      'vpn_lab_sessions',
      'id',
      'id',
      testSessionId,
    )
    requireCondition(hiddenSession === null, 'CROSS_OWNER_SESSION_READ_SUCCEEDED')
    const otherSessionApi = await request(
      `/api/v1/device-peer-sessions/${testSessionId}`,
      otherApiToken,
    )
    requireCondition(otherSessionApi.status === 404, 'CROSS_OWNER_SESSION_API_READ_SUCCEEDED')
    const directSessionUpdate = await ownerClient
      .from('vpn_lab_sessions')
      .update({ status: 'connecting' })
      .eq('id', testSessionId)
      .select('id')
    requireWriteDenied(directSessionUpdate, 'DIRECT_SESSION_WRITE_ALLOWED')
    console.log(`PASS device-peer session persisted with owner/device/peer (${testSessionId})`)

    phase = 'backend-restart'
    const firstBackend = child
    await stopBackend(firstBackend)
    child = undefined
    console.log('PASS first backend instance stopped gracefully')

    await startBackend()
    const restored = await request(
      `/api/v1/device-peer-sessions/${testSessionId}`,
      ownerApiToken,
    )
    const restoredData = restored.payload?.data
    requireCondition(
      restored.status === 200
        && restoredData?.status === 'interrupted'
        && restoredData?.user_id === ownerUserId
        && restoredData?.device_id === testDeviceId
        && restoredData?.peer_id === testPeerId,
      'DEVICE_PEER_SESSION_RESTORE_MISMATCH',
    )
    const restoredRow = await selectOwnRow(
      ownerClient,
      'vpn_lab_sessions',
      'id,user_id,device_id,peer_id,gateway_mode,status',
      'id',
      testSessionId,
    )
    requireCondition(
      restoredRow?.user_id === ownerUserId
        && restoredRow.device_id === testDeviceId
        && restoredRow.peer_id === testPeerId
        && restoredRow.gateway_mode === 'device_peer'
        && restoredRow.status === 'interrupted',
      'DEVICE_PEER_SESSION_STAGING_RESTORE_MISMATCH',
    )
    const peerAfterRestart = await selectOwnRow(
      ownerClient,
      'wireguard_device_peers',
      'id,user_id,device_id,status',
      'id',
      testPeerId,
    )
    requireCondition(
      peerAfterRestart?.user_id === ownerUserId
        && peerAfterRestart.device_id === testDeviceId
        && peerAfterRestart.status === 'active',
      'DEVICE_PEER_STAGING_ROW_NOT_RESTORED',
    )
    console.log('PASS Supabase peer/session associations restored; no-handshake state is interrupted')

    phase = 'stop-and-revoke-test-records'
    const stop = await request(
      `/api/v1/device-peer-sessions/${testSessionId}/stop`,
      ownerApiToken,
      'POST',
      {},
    )
    requireCondition(
      stop.status === 200 && stop.payload?.data?.status === 'stopped',
      'TEST_DEVICE_PEER_SESSION_STOP_FAILED',
    )
    sessionStopped = true
    const revoke = await request(
      `/api/v1/devices/${testDeviceId}/revoke`,
      ownerApiToken,
      'POST',
      {},
    )
    requireCondition(
      revoke.status === 200 && revoke.payload?.data?.status === 'revoked',
      'TEST_DEVICE_REVOCATION_FAILED',
    )
    deviceRevoked = true
    const retainedPeer = await selectOwnRow(
      ownerClient,
      'wireguard_device_peers',
      'id,user_id,device_id,status',
      'id',
      testPeerId,
    )
    const retainedSession = await selectOwnRow(
      ownerClient,
      'vpn_lab_sessions',
      'id,user_id,device_id,peer_id,status',
      'id',
      testSessionId,
    )
    requireCondition(
      retainedPeer?.status === 'revoked'
        && retainedSession?.status === 'stopped'
        && retainedSession.peer_id === testPeerId
        && retainedSession.device_id === testDeviceId,
      'TEST_ROWS_NOT_RETAINED_WITH_FINAL_ASSOCIATIONS',
    )
    console.log('PASS test device revoked; stopped peer/session rows retained without deletion')

    const secondBackend = child
    await stopBackend(secondBackend)
    child = undefined
    console.log('PASS second backend instance stopped gracefully')
  }

  try {
    await run()
  } catch (error) {
    const safeCode = typeof error?.safeCode === 'string'
      ? error.safeCode
      : typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : 'UNEXPECTED_ERROR'
    console.error(`FAIL ${phase} ${safeCode}`)
    process.exitCode = 1
  } finally {
    try {
      await cleanup()
    } catch (error) {
      const safeCode = typeof error?.safeCode === 'string' ? error.safeCode : 'CLEANUP_FAILED'
      console.error(`FAIL cleanup ${safeCode}`)
      process.exitCode = 1
    }
  }
}
