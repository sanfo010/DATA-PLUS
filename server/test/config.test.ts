import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadConfig } from '../src/config.js'

const baseEnvironment = {
  SUPABASE_URL: 'https://project.example.test',
  SUPABASE_ANON_KEY: 'test-publishable-key',
  NODE_ENV: 'development',
}

test('per-device lab peers require a server-only service role', () => {
  assert.throws(
    () => loadConfig({ ...baseEnvironment, DATAPLUS_WG_DEVICES_ENABLED: '1' }),
    /SUPABASE_SERVICE_ROLE_KEY is required/,
  )
})

test('persistent lab sessions require the local shared lab and service role', () => {
  assert.throws(
    () => loadConfig({
      ...baseEnvironment,
      DATAPLUS_WG_SESSION_PERSISTENCE: '1',
      SUPABASE_SERVICE_ROLE_KEY: 'test-server-only-key',
    }),
    /requires DATAPLUS_WG_LAB_ENABLED=1/,
  )
})

test('WireGuard lab features are refused in production', () => {
  assert.throws(
    () => loadConfig({
      ...baseEnvironment,
      NODE_ENV: 'production',
      DATAPLUS_WG_DEVICES_ENABLED: '1',
      SUPABASE_SERVICE_ROLE_KEY: 'test-server-only-key',
    }),
    /restricted to local laboratory environments/,
  )
})

test('local device-peer configuration requires the service role', () => {
  const config = loadConfig({
    ...baseEnvironment,
    DATAPLUS_WG_DEVICES_ENABLED: '1',
    SUPABASE_SERVICE_ROLE_KEY: 'test-server-only-key',
  })
  assert.equal(config.wireGuardDevicesEnabled, true)
  assert.equal(config.supabaseServiceRoleKey, 'test-server-only-key')
})

test('WireGuard device endpoint is validated and optional until configuration retrieval', () => {
  const config = loadConfig({
    ...baseEnvironment,
    DATAPLUS_WG_DEVICE_ENDPOINT: 'vpn.example.test:51821',
  })
  assert.equal(config.wireGuardDeviceEndpoint, 'vpn.example.test:51821')
  assert.throws(
    () => loadConfig({
      ...baseEnvironment,
      DATAPLUS_WG_DEVICE_ENDPOINT: 'vpn.example.test:70000',
    }),
    /DATAPLUS_WG_DEVICE_ENDPOINT must be a host:port endpoint/,
  )
})
