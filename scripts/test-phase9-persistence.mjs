import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

const execFileAsync = promisify(execFile)
const scriptPath = fileURLToPath(import.meta.url)
const expectedProjectHost = 'epmcynygxvywdnvjnxan.supabase.co'
const testPort = 3011
const testBaseUrl = `http://127.0.0.1:${testPort}`
const confirmation = 'I_CONFIRM_THIS_IS_STAGING'
const sessionStatusesOpen = [
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
  let testSessionId
  let ownerUserId
  let sessionIdempotencyKey
  let deviceIdempotencyKey
  let ownerApiToken
  let otherApiToken
  let ownerClient
  let sessionCleanupEligible = false
  let sessionStopped = false
  let deviceRevoked = false
  const readyBackendChildren = new WeakSet()

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

  function value(name, fileValues) {
    return process.env[name] || fileValues[name] || ''
  }

  function normalizedOrigin(url) {
    try {
      return new URL(url).origin
    } catch {
      return null
    }
  }

  function stagingConfig() {
    requireCondition(
      process.argv.includes('--confirm-staging-writes'),
      'COMMAND_LINE_STAGING_CONFIRMATION_MISSING',
    )
    requireCondition(
      process.argv.includes('--open-shared-lab-sessions=0'),
      'OPEN_SESSION_PREFLIGHT_NOT_CONFIRMED',
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
    requireCondition(required.every((name) => value(name, fileValues)), 'STAGING_CONFIG_INCOMPLETE')

    const config = Object.fromEntries(required.map((name) => [name, value(name, fileValues)]))
    requireCondition(config.DATAPLUS_STAGING_CONFIRM_WRITES === confirmation, 'STAGING_WRITE_CONFIRMATION_MISSING')

    const stageUrl = new URL(config.DATAPLUS_STAGING_URL)
    requireCondition(stageUrl.protocol === 'https:' && stageUrl.host === expectedProjectHost, 'STAGING_TARGET_MISMATCH')
    requireCondition(
      normalizedOrigin(process.env.SUPABASE_URL) === stageUrl.origin,
      'BACKEND_URL_NOT_STAGING',
    )
    requireCondition(
      process.env.SUPABASE_ANON_KEY === config.DATAPLUS_STAGING_ANON_KEY,
      'BACKEND_ANON_KEY_MISMATCH',
    )
    requireCondition(Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()), 'BACKEND_SERVICE_ROLE_MISSING')
    requireCondition(
      process.env.DATAPLUS_WG_LAB_ENABLED === '1'
      && process.env.DATAPLUS_WG_DEVICES_ENABLED === '1'
      && process.env.DATAPLUS_WG_SESSION_PERSISTENCE === '1',
      'BACKEND_LAB_FLAGS_NOT_ENABLED',
    )
    requireCondition(process.env.NODE_ENV !== 'production', 'PRODUCTION_ENVIRONMENT_REFUSED')
    requireCondition(
      config.DATAPLUS_STAGING_USER_A_EMAIL.toLowerCase()
      !== config.DATAPLUS_STAGING_USER_B_EMAIL.toLowerCase(),
      'STAGING_TEST_USERS_NOT_DISTINCT',
    )

    const appEnvPath = resolve(process.cwd(), '.env.local')
    if (existsSync(appEnvPath)) {
      const appEnv = readFileSync(appEnvPath, 'utf8')
      const appUrl = appEnv.match(/^\s*VITE_SUPABASE_URL\s*=\s*(.+)\s*$/m)?.[1]
        ?.trim()
        .replace(/^(['"])(.*)\1$/, '$2')
      requireCondition(
        !appUrl || normalizedOrigin(appUrl) !== stageUrl.origin,
        'STAGING_MATCHES_FRONTEND_PROJECT',
      )
    }

    return {
      url: stageUrl.toString().replace(/\/$/, ''),
      anonKey: config.DATAPLUS_STAGING_ANON_KEY,
      ownerEmail: config.DATAPLUS_STAGING_USER_A_EMAIL,
      ownerPassword: config.DATAPLUS_STAGING_USER_A_PASSWORD,
      otherEmail: config.DATAPLUS_STAGING_USER_B_EMAIL,
      otherPassword: config.DATAPLUS_STAGING_USER_B_PASSWORD,
    }
  }

  async function runWslReadOnly(args) {
    const { stdout } = await execFileAsync(
      'wsl.exe',
      ['--distribution', 'Ubuntu', '--user', 'root', '--', ...args],
      { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 },
    )
    return stdout.trim()
  }

  async function verifyLabPreconditions() {
    const interfaces = JSON.parse(await runWslReadOnly(['ip', '-j', 'link', 'show']))
    const interfaceNames = new Set(interfaces.map((item) => item.ifname))
    for (const name of ['wgdataplus', 'wgdpdev0', 'dpveth0']) {
      requireCondition(!interfaceNames.has(name), `WSL_INTERFACE_ALREADY_PRESENT_${name.toUpperCase()}`)
    }

    const namespaces = await runWslReadOnly(['ip', 'netns', 'list'])
    requireCondition(
      !namespaces.split(/\r?\n/).some((line) => line.trim().split(/\s+/)[0] === 'dataplus-client'),
      'WSL_TEST_NAMESPACE_ALREADY_PRESENT',
    )

    const directoryMode = await runWslReadOnly(['stat', '-c', '%a', '/root/dataplus-lab'])
    requireCondition(directoryMode === '700', 'WSL_LAB_DIRECTORY_MODE_UNEXPECTED')
    for (const path of ['/root/dataplus-lab/server.key', '/root/dataplus-lab/client.key']) {
      const mode = await runWslReadOnly(['stat', '-c', '%a', path])
      requireCondition(mode === '600', `WSL_PRIVATE_KEY_MODE_UNEXPECTED_${path.endsWith('server.key') ? 'SERVER' : 'CLIENT'}`)
    }
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

  function createUserClient(url, anonKey, accessToken) {
    return createClient(url, anonKey, {
      ...authOptions,
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })
  }

  async function signIn(url, anonKey, email, password) {
    const client = createClient(url, anonKey, authOptions)
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    requireCondition(!error && data.user && data.session?.access_token, 'STAGING_AUTH_FAILED')
    return {
      userId: data.user.id,
      accessToken: data.session.access_token,
      client: createUserClient(url, anonKey, data.session.access_token),
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
    return environment
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
        if (processChild.connected) {
          processChild.send({ type: 'shutdown' }, () => {})
        }
        const forceStop = setTimeout(() => {
          if (processChild.exitCode === null) processChild.kill()
        }, 5_000)
        forceStop.unref()
      }, 30_000)

      processChild.on('message', (message) => {
        if (settled) return
        if (message?.type === 'ready') {
          settled = true
          readyBackendChildren.add(processChild)
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
    if (!processChild) return
    if (processChild.exitCode !== null) {
      requireCondition(
        !readyBackendChildren.has(processChild) || processChild.exitCode === 0,
        'BACKEND_GRACEFUL_STOP_FAILED',
      )
      return
    }
    await new Promise((resolveStop, rejectStop) => {
      const timeout = setTimeout(() => {
        const error = new Error()
        error.safeCode = 'BACKEND_GRACEFUL_STOP_TIMEOUT'
        rejectStop(error)
      }, 20_000)
      processChild.once('exit', (code) => {
        clearTimeout(timeout)
        if (code === 0 || !readyBackendChildren.has(processChild)) resolveStop()
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

  async function selectOwnRow(client, table, columns, key, valueToMatch) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .eq(key, valueToMatch)
      .maybeSingle()
    requireCondition(!error, `STAGING_RLS_READ_FAILED_${table.toUpperCase()}`)
    return data
  }

  async function cleanupTestData() {
    if (testSessionId && !sessionCleanupEligible && ownerClient) {
      try {
        const { data, error } = await ownerClient
          .from('vpn_lab_sessions')
          .select('id,user_id,device_id,status')
          .eq('id', testSessionId)
          .maybeSingle()
        if (
          !error
          && data?.user_id === ownerUserId
          && data.device_id === testDeviceId
        ) {
          sessionCleanupEligible = true
          sessionStopped = data.status === 'stopped'
        }
      } catch {
        sessionCleanupEligible = false
      }
    }

    if (!testSessionId && sessionIdempotencyKey && ownerClient) {
      try {
        const { data, error } = await ownerClient
          .from('vpn_lab_sessions')
          .select('id,user_id,device_id,status')
          .eq('idempotency_key', sessionIdempotencyKey)
          .maybeSingle()
        if (
          !error
          && data?.id
          && data.user_id === ownerUserId
          && data.device_id === testDeviceId
        ) {
          testSessionId = data.id
          sessionCleanupEligible = true
          sessionStopped = data.status === 'stopped'
        }
      } catch {
        testSessionId = undefined
      }
    }

    if (child && sessionCleanupEligible && testSessionId && ownerApiToken && !sessionStopped) {
      try {
        const result = await request(
          `/api/v1/lab/sessions/${testSessionId}/stop`,
          ownerApiToken,
          'POST',
          {},
        )
        sessionStopped = result.status === 200 && result.payload?.data?.status === 'stopped'
      } catch {
        sessionStopped = false
      }
    }

    if (sessionCleanupEligible && !sessionStopped) {
      try {
        const scriptDirectory = resolve(process.cwd(), 'scripts')
        const match = scriptDirectory.match(/^([A-Za-z]):\\(.*)$/)
        requireCondition(Boolean(match), 'WSL_SCRIPT_PATH_INVALID')
        const [, drive, rest] = match
        const stopScript = `/mnt/${drive.toLowerCase()}/${rest.replaceAll('\\', '/')}/stop-wg-lab.sh`
        const { stdout } = await execFileAsync(
          'wsl.exe',
          ['--distribution', 'Ubuntu', '--user', 'root', '--', 'bash', stopScript],
          { windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 },
        )
        requireCondition(stdout.trim() === 'DATAPLUS_WG_LAB_STOPPED', 'WSL_TEST_TUNNEL_STOP_FAILED')
        if (child && testSessionId && ownerApiToken) {
          const reconcile = await request(
            '/api/v1/lab/sessions/reconcile',
            ownerApiToken,
            'POST',
            {},
          )
          sessionStopped = reconcile.status === 200
            && reconcile.payload?.data?.some((session) =>
              session.id === testSessionId && session.status === 'stopped')
        }
      } catch {
        sessionStopped = false
      }
    }

    if (
      child
      && testDeviceId
      && ownerApiToken
      && !deviceRevoked
      && (!sessionCleanupEligible || sessionStopped)
    ) {
      try {
        const result = await request(
          `/api/v1/devices/${testDeviceId}/revoke`,
          ownerApiToken,
          'POST',
          {},
        )
        deviceRevoked = result.status === 200 && result.payload?.data?.status === 'revoked'
      } catch {
        deviceRevoked = false
      }
    }

    if (child) {
      const processChild = child
      await stopBackend(processChild)
      child = undefined
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
    console.log('PASS staging target and write guard')

    await verifyPortAvailable()
    await verifyLabPreconditions()
    console.log('PASS isolated backend port and WSL lab preconditions')

    phase = 'staging-authentication'
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
    ownerApiToken = owner.accessToken
    otherApiToken = other.accessToken
    ownerUserId = owner.userId
    ownerClient = owner.client
    staging.ownerPassword = ''
    staging.otherPassword = ''
    staging.ownerEmail = ''
    staging.otherEmail = ''
    console.log('PASS two distinct staging test accounts authenticated')

    phase = 'backend-start'
    child = await startBackend()
    const health = await fetch(`${testBaseUrl}/health`, { signal: AbortSignal.timeout(5_000) })
    requireCondition(health.ok, 'BACKEND_HEALTH_FAILED')
    const capabilitiesResponse = await fetch(`${testBaseUrl}/api/v1/capabilities`, {
      signal: AbortSignal.timeout(5_000),
    })
    const capabilities = await capabilitiesResponse.json()
    requireCondition(
      capabilitiesResponse.ok
      && capabilities.data?.gateway === 'local_wsl_lab'
      && capabilities.data?.devicePeers === 'enabled'
      && capabilities.data?.labSessionPersistence === 'enabled',
      'BACKEND_CAPABILITIES_MISMATCH',
    )
    const ownerCurrent = await request('/api/v1/lab/sessions/current', ownerApiToken)
    const otherCurrent = await request('/api/v1/lab/sessions/current', otherApiToken)
    requireCondition(
      ownerCurrent.status === 200
      && ownerCurrent.payload?.data === null
      && otherCurrent.status === 200
      && otherCurrent.payload?.data === null,
      'STAGING_TEST_ACCOUNT_ALREADY_HAS_OPEN_SESSION',
    )
    console.log('PASS isolated backend started on loopback; service-role repository initialized')

    phase = 'device-registration'
    deviceIdempotencyKey = randomUUID()
    const deviceName = `PHASE9-PERSIST-${randomUUID().slice(0, 8)}`
    const deviceResponse = await request('/api/v1/devices', ownerApiToken, 'POST', {
      device_name: deviceName,
      platform: 'web',
      idempotency_key: deviceIdempotencyKey,
    })
    requireCondition(deviceResponse.status === 201, 'TEST_DEVICE_REGISTRATION_FAILED')
    testDeviceId = deviceResponse.payload?.data?.id
    requireCondition(
      typeof testDeviceId === 'string'
      && deviceResponse.payload?.data?.user_id === owner.userId,
      'TEST_DEVICE_OWNER_MISMATCH',
    )
    const deviceRow = await selectOwnRow(
      ownerClient,
      'devices',
      'id,user_id,status,device_name',
      'id',
      testDeviceId,
    )
    requireCondition(
      deviceRow?.id === testDeviceId
      && deviceRow.user_id === owner.userId
      && deviceRow.device_name === deviceName
      && deviceRow.status === 'active',
      'TEST_DEVICE_STAGING_ROW_MISMATCH',
    )
    const otherDeviceRow = await selectOwnRow(
      other.client,
      'devices',
      'id',
      'id',
      testDeviceId,
    )
    requireCondition(otherDeviceRow === null, 'CROSS_OWNER_DEVICE_READ_SUCCEEDED')
    console.log(`PASS test device persisted with owner association (${testDeviceId})`)

    phase = 'session-create'
    sessionIdempotencyKey = randomUUID()
    const sessionResponse = await request('/api/v1/lab/sessions', ownerApiToken, 'POST', {
      device_id: testDeviceId,
      idempotency_key: sessionIdempotencyKey,
    }, 60_000)
    requireCondition(sessionResponse.status === 201, 'TEST_LAB_SESSION_START_FAILED')
    testSessionId = sessionResponse.payload?.data?.id
    requireCondition(
      typeof testSessionId === 'string'
      && sessionResponse.payload?.data?.status === 'connected'
      && sessionResponse.payload?.data?.user_id === owner.userId
      && sessionResponse.payload?.data?.device_id === testDeviceId,
      'TEST_LAB_SESSION_OWNER_DEVICE_MISMATCH',
    )
    const sessionRow = await selectOwnRow(
      ownerClient,
      'vpn_lab_sessions',
      'id,user_id,device_id,peer_id,gateway_mode,status',
      'id',
      testSessionId,
    )
    requireCondition(
      sessionRow?.id === testSessionId
      && sessionRow.user_id === owner.userId
      && sessionRow.device_id === testDeviceId
      && sessionRow.peer_id === null
      && sessionRow.gateway_mode === 'shared_lab'
      && sessionRow.status === 'connected',
      'TEST_SESSION_STAGING_ROW_MISMATCH',
    )
    sessionCleanupEligible = true
    const otherSessionRow = await selectOwnRow(
      other.client,
      'vpn_lab_sessions',
      'id',
      'id',
      testSessionId,
    )
    requireCondition(otherSessionRow === null, 'CROSS_OWNER_SESSION_READ_SUCCEEDED')
    const otherSessionResponse = await request(
      `/api/v1/lab/sessions/${testSessionId}`,
      otherApiToken,
    )
    requireCondition(otherSessionResponse.status === 404, 'CROSS_OWNER_SESSION_API_READ_SUCCEEDED')
    console.log(`PASS session persisted with owner/device association (${testSessionId})`)

    phase = 'backend-restart'
    const oldChild = child
    await stopBackend(oldChild)
    child = undefined
    console.log('PASS first backend instance stopped gracefully')

    child = await startBackend()
    const restoredResponse = await request(
      `/api/v1/lab/sessions/${testSessionId}`,
      ownerApiToken,
    )
    requireCondition(
      restoredResponse.status === 200
      && restoredResponse.payload?.data?.status === 'connected'
      && restoredResponse.payload?.data?.user_id === owner.userId
      && restoredResponse.payload?.data?.device_id === testDeviceId,
      'SESSION_NOT_RESTORED_AS_CONNECTED',
    )
    const restoredRow = await selectOwnRow(
      ownerClient,
      'vpn_lab_sessions',
      'id,user_id,device_id,peer_id,gateway_mode,status',
      'id',
      testSessionId,
    )
    requireCondition(
      restoredRow?.id === testSessionId
      && restoredRow.user_id === owner.userId
      && restoredRow.device_id === testDeviceId
      && restoredRow.peer_id === null
      && restoredRow.gateway_mode === 'shared_lab'
      && restoredRow.status === 'connected',
      'SESSION_STAGING_ASSOCIATION_CHANGED_AFTER_RESTART',
    )
    const otherRestoredResponse = await request(
      `/api/v1/lab/sessions/${testSessionId}`,
      otherApiToken,
    )
    requireCondition(otherRestoredResponse.status === 404, 'CROSS_OWNER_SESSION_READ_AFTER_RESTART_SUCCEEDED')
    console.log('PASS session restored after backend restart with owner/device/status intact')

    phase = 'session-stop'
    const stopResponse = await request(
      `/api/v1/lab/sessions/${testSessionId}/stop`,
      ownerApiToken,
      'POST',
      {},
    )
    requireCondition(
      stopResponse.status === 200
      && stopResponse.payload?.data?.status === 'stopped',
      'TEST_SESSION_STOP_NOT_CONFIRMED',
    )
    sessionStopped = true
    const stoppedRow = await selectOwnRow(
      ownerClient,
      'vpn_lab_sessions',
      'id,user_id,device_id,status',
      'id',
      testSessionId,
    )
    requireCondition(
      stoppedRow?.id === testSessionId
      && stoppedRow.user_id === owner.userId
      && stoppedRow.device_id === testDeviceId
      && stoppedRow.status === 'stopped',
      'STOPPED_SESSION_NOT_PERSISTED',
    )
    const gatewayResponse = await request('/api/v1/lab/gateway', ownerApiToken)
    requireCondition(
      gatewayResponse.status === 200
      && gatewayResponse.payload?.data?.status === 'stopped',
      'WSL_LAB_STOP_NOT_CONFIRMED',
    )
    console.log('PASS stopped state persisted; WSL shared tunnel confirmed stopped')

    phase = 'test-device-revocation'
    const revokeResponse = await request(
      `/api/v1/devices/${testDeviceId}/revoke`,
      ownerApiToken,
      'POST',
      {},
    )
    requireCondition(
      revokeResponse.status === 200
      && revokeResponse.payload?.data?.status === 'revoked',
      'TEST_DEVICE_REVOCATION_FAILED',
    )
    deviceRevoked = true
    const revokedDeviceRow = await selectOwnRow(
      ownerClient,
      'devices',
      'id,user_id,status,device_name',
      'id',
      testDeviceId,
    )
    const retainedSessionRow = await selectOwnRow(
      ownerClient,
      'vpn_lab_sessions',
      'id,user_id,device_id,status',
      'id',
      testSessionId,
    )
    requireCondition(
      revokedDeviceRow?.user_id === owner.userId
      && revokedDeviceRow.status === 'revoked'
      && retainedSessionRow?.id === testSessionId
      && retainedSessionRow.device_id === testDeviceId
      && retainedSessionRow.status === 'stopped',
      'TEST_ROWS_NOT_RETAINED_WITH_ASSOCIATION',
    )
    console.log('PASS test device revoked; device/session test rows retained (no deletion)')

    phase = 'backend-final-stop'
    const lastChild = child
    await stopBackend(lastChild)
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
        : error?.name === 'AssertionError'
          ? 'ASSERTION_FAILED'
          : 'UNEXPECTED_ERROR'
    console.error(`FAIL ${phase} ${safeCode}`)
    process.exitCode = 1
  } finally {
    try {
      await cleanupTestData()
    } catch (error) {
      const safeCode = typeof error?.safeCode === 'string' ? error.safeCode : 'CLEANUP_FAILED'
      console.error(`FAIL cleanup ${safeCode}`)
      process.exitCode = 1
    }
  }
}
