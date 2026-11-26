import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const confirmation = 'I_CONFIRM_THIS_IS_STAGING';
const stagingEnvPath = resolve(process.cwd(), '.env.staging.local');
if (existsSync(stagingEnvPath)) {
  const lines = readFileSync(stagingEnvPath, 'utf8').split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z\d_]*)\s*=\s*(.*)$/);
    if (!match) {
      throw new Error(`Invalid .env.staging.local entry on line ${index + 1}.`);
    }

    const [, name, rawValue] = match;
    const value = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2');
    process.env[name] ??= value;
  }
}

const requiredVariables = [
  'DATAPLUS_STAGING_URL',
  'DATAPLUS_STAGING_ANON_KEY',
  'DATAPLUS_STAGING_USER_A_EMAIL',
  'DATAPLUS_STAGING_USER_A_PASSWORD',
  'DATAPLUS_STAGING_USER_B_EMAIL',
  'DATAPLUS_STAGING_USER_B_PASSWORD',
  'DATAPLUS_STAGING_CONFIRM_WRITES',
];

function normalizedOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const missing = requiredVariables.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Set them in .env.staging.local (see .env.staging.local.example) or in the process environment.');
  process.exit(1);
}

if (process.env.DATAPLUS_STAGING_CONFIRM_WRITES !== confirmation) {
  console.error('Refusing to write without the explicit staging confirmation.');
  process.exit(1);
}

const envLocalPath = resolve(process.cwd(), '.env.local');
if (existsSync(envLocalPath)) {
  const envLocal = readFileSync(envLocalPath, 'utf8');
  const configuredUrl = envLocal.match(/^\s*VITE_SUPABASE_URL\s*=\s*(.+)\s*$/m)?.[1]
    ?.trim()
    .replace(/^(['"])(.*)\1$/, '$2');

  if (
    configuredUrl
    && normalizedOrigin(configuredUrl) === normalizedOrigin(process.env.DATAPLUS_STAGING_URL)
  ) {
    console.error('Refusing to run: staging URL matches the app project in .env.local.');
    process.exit(1);
  }
}

if (
  process.env.DATAPLUS_STAGING_USER_A_EMAIL.toLowerCase()
  === process.env.DATAPLUS_STAGING_USER_B_EMAIL.toLowerCase()
) {
  console.error('Two distinct staging users are required.');
  process.exit(1);
}

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
};

const userA = createClient(
  process.env.DATAPLUS_STAGING_URL,
  process.env.DATAPLUS_STAGING_ANON_KEY,
  clientOptions,
);
const userB = createClient(
  process.env.DATAPLUS_STAGING_URL,
  process.env.DATAPLUS_STAGING_ANON_KEY,
  clientOptions,
);

const created = {
  devicesA: [],
  devicesB: [],
  sessionsA: [],
  sessionsB: [],
};
let failed = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(label) {
  console.log(`PASS ${label}`);
}

function record(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function signIn(client, emailVariable, passwordVariable) {
  const { data, error } = await client.auth.signInWithPassword({
    email: process.env[emailVariable],
    password: process.env[passwordVariable],
  });
  assert(!error && data.user, `Sign-in failed for ${emailVariable}.`);
  return data.user;
}

async function expectError(label, request) {
  const { error } = await request;
  assert(error, `${label}: expected the operation to be denied.`);
  pass(label);
}

async function registerDevice(client, name, key) {
  const { data, error } = await client.rpc('register_dataplus_device', {
    p_device_name: name,
    p_platform: 'web',
    p_registration_key: key,
  });
  assert(!error, `Device registration failed: ${error?.message}`);
  return record(data);
}

async function requestSession(client, deviceId, key) {
  const { data, error } = await client.rpc('request_dataplus_session', {
    p_device_id: deviceId,
    p_idempotency_key: key,
  });
  assert(!error, `Session request failed: ${error?.message}`);
  return record(data);
}

async function stopSession(client, sessionId) {
  return client.rpc('request_dataplus_session_stop', {
    p_session_id: sessionId,
  });
}

async function revokeDevice(client, deviceId) {
  return client.rpc('revoke_dataplus_device', {
    p_device_id: deviceId,
  });
}

async function readOwnRow(client, table, id) {
  const { data, error } = await client.from(table).select('id').eq('id', id);
  assert(!error, `Could not read ${table}: ${error?.message}`);
  return data;
}

async function cleanup() {
  const cleanupErrors = [];
  const clients = [
    { client: userA, sessions: created.sessionsA, devices: created.devicesA },
    { client: userB, sessions: created.sessionsB, devices: created.devicesB },
  ];

  for (const { client, sessions, devices } of clients) {
    for (const sessionId of sessions) {
      const { error } = await stopSession(client, sessionId);
      if (error) cleanupErrors.push(`Could not stop test session: ${error.message}`);
    }
    for (const deviceId of devices) {
      const { error } = await revokeDevice(client, deviceId);
      if (error) cleanupErrors.push(`Could not revoke test device: ${error.message}`);
    }
  }

  for (const client of [userA, userB]) {
    const { error } = await client.auth.signOut();
    if (error) cleanupErrors.push(`Could not sign out test account: ${error.message}`);
  }

  return cleanupErrors;
}

try {
  const accountA = await signIn(userA, 'DATAPLUS_STAGING_USER_A_EMAIL', 'DATAPLUS_STAGING_USER_A_PASSWORD');
  const accountB = await signIn(userB, 'DATAPLUS_STAGING_USER_B_EMAIL', 'DATAPLUS_STAGING_USER_B_PASSWORD');
  assert(accountA.id !== accountB.id, 'The credentials resolved to the same Auth user.');
  pass('two distinct Auth users sign in');

  const peerDirectInsertA = await userA
    .from('wireguard_device_peers')
    .insert({
      id: randomUUID(),
      user_id: accountA.id,
      device_id: randomUUID(),
      public_key: 'A'.repeat(43) + '=',
      assigned_ip: '10.78.0.10',
    });
  assert(peerDirectInsertA.error, 'Direct WireGuard peer insert unexpectedly succeeded.');
  pass('direct WireGuard peer write denied');

  const labSessionDirectInsertA = await userA
    .from('vpn_lab_sessions')
    .insert({
      id: randomUUID(),
      user_id: accountA.id,
      device_id: randomUUID(),
      gateway_mode: 'shared_lab',
      idempotency_key: randomUUID(),
      status: 'requested',
    });
  assert(labSessionDirectInsertA.error, 'Direct persistent lab session insert unexpectedly succeeded.');
  pass('direct persistent lab session write denied');

  const keyA = randomUUID();
  const deviceA = await registerDevice(userA, `Phase 6 A ${keyA.slice(0, 8)}`, keyA);
  created.devicesA.push(deviceA.id);
  const repeatedDeviceA = await registerDevice(userA, `Phase 6 A ${keyA.slice(0, 8)}`, keyA);
  assert(deviceA.id === repeatedDeviceA.id, 'Device registration retry created a duplicate.');
  pass('device registration and idempotent retry');

  await expectError(
    'registration idempotency key rejects changed payload',
    userA.rpc('register_dataplus_device', {
      p_device_name: `Changed ${keyA.slice(0, 8)}`,
      p_platform: 'web',
      p_registration_key: keyA,
    }),
  );

  const keyB = randomUUID();
  const deviceB = await registerDevice(userB, `Phase 6 B ${keyB.slice(0, 8)}`, keyB);
  created.devicesB.push(deviceB.id);

  assert(
    (await readOwnRow(userA, 'devices', deviceA.id)).length === 1,
    'User A could not read their own device.',
  );
  assert(
    (await readOwnRow(userB, 'devices', deviceB.id)).length === 1,
    'User B could not read their own device.',
  );
  assert(
    (await readOwnRow(userA, 'devices', deviceB.id)).length === 0
      && (await readOwnRow(userB, 'devices', deviceA.id)).length === 0,
    'Device rows were visible across users.',
  );
  pass('device owner reads and cross-user isolation');

  const sessionKeyA = randomUUID();
  const sessionA = await requestSession(userA, deviceA.id, sessionKeyA);
  created.sessionsA.push(sessionA.id);
  const repeatedSessionA = await requestSession(userA, deviceA.id, sessionKeyA);
  assert(sessionA.id === repeatedSessionA.id, 'Session retry created a duplicate.');
  assert(sessionA.status === 'requested', 'New session did not start as requested.');
  pass('session request and idempotent retry');

  assert(
    (await readOwnRow(userA, 'vpn_sessions', sessionA.id)).length === 1
      && (await readOwnRow(userB, 'vpn_sessions', sessionA.id)).length === 0,
    'Session owner visibility is incorrect.',
  );
  pass('session owner reads and cross-user isolation');

  await expectError(
    'user B cannot stop user A session',
    stopSession(userB, sessionA.id),
  );
  await expectError(
    'user B cannot revoke user A device',
    revokeDevice(userB, deviceA.id),
  );
  await expectError(
    'user B cannot request a session using user A device',
    userB.rpc('request_dataplus_session', {
      p_device_id: deviceA.id,
      p_idempotency_key: randomUUID(),
    }),
  );
  await expectError(
    'requested device cannot be revoked while its session is open',
    revokeDevice(userA, deviceA.id),
  );

  await expectError(
    'direct session status update is denied',
    userA.from('vpn_sessions')
      .update({ status: 'failed' })
      .eq('id', sessionA.id)
      .select('id'),
  );
  await expectError(
    'direct wallet balance update is denied',
    userA.from('wallets')
      .update({ available_mb: 999999 })
      .eq('user_id', accountA.id)
      .select('user_id'),
  );

  const stopResult = await stopSession(userA, sessionA.id);
  assert(!stopResult.error, `Session stop failed: ${stopResult.error?.message}`);
  assert(record(stopResult.data).status === 'stopped', 'Requested session did not stop.');
  pass('owner can stop a requested session');

  const sessionKeyB = randomUUID();
  const sessionB = await requestSession(userB, deviceB.id, sessionKeyB);
  created.sessionsB.push(sessionB.id);
  assert(
    (await readOwnRow(userA, 'vpn_sessions', sessionB.id)).length === 0
      && (await readOwnRow(userB, 'vpn_sessions', sessionB.id)).length === 1,
    'User B session visibility is incorrect.',
  );
  pass('second account can create and read its own session only');
  const stopResultB = await stopSession(userB, sessionB.id);
  assert(!stopResultB.error, `User B session stop failed: ${stopResultB.error?.message}`);

  for (const [client, deviceId, account] of [
    [userA, deviceA.id, 'A'],
    [userB, deviceB.id, 'B'],
  ]) {
    const { data, error } = await revokeDevice(client, deviceId);
    assert(!error, `User ${account} device cleanup failed: ${error?.message}`);
    assert(record(data).status === 'revoked', `User ${account} device was not revoked.`);
  }
  pass('test devices revoked and test sessions stopped');
} catch (error) {
  failed = true;
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
} finally {
  const cleanupErrors = await cleanup();
  for (const error of cleanupErrors) {
    failed = true;
    console.error(`CLEANUP FAIL ${error}`);
  }
}

if (failed) process.exitCode = 1;
