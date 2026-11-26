import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ServerConfig } from '../src/config.js'
import { SupabaseTokenAuthenticator } from '../src/supabase-data.js'

const config: ServerConfig = {
  port: 3001,
  supabaseUrl: 'https://auth.example.test',
  supabaseAnonKey: 'test-publishable-key',
  allowedOrigins: [],
}

test('Supabase authenticator verifies the bearer token through auth.getUser', async () => {
  const observedAuthorization: string[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    observedAuthorization.push(headers.get('Authorization') ?? '')
    const url = String(input)
    if (!url.endsWith('/auth/v1/user')) {
      return Response.json({ message: 'Unexpected test request' }, { status: 500 })
    }
    if (headers.get('Authorization') === 'Bearer signed-test-token') {
      return Response.json({
        id: '00000000-0000-4000-8000-000000000001',
        email: 'user@example.test',
        role: 'authenticated',
        aud: 'authenticated',
        created_at: '2026-01-01T00:00:00.000Z',
        app_metadata: {},
        user_metadata: {},
      })
    }
    return Response.json({ code: 'bad_jwt', message: 'Invalid JWT' }, { status: 401 })
  }

  const authenticator = new SupabaseTokenAuthenticator(config, fetcher)
  const verified = await authenticator.authenticate('signed-test-token')
  assert.equal(verified?.user.id, '00000000-0000-4000-8000-000000000001')
  assert.deepEqual(observedAuthorization, ['Bearer signed-test-token'])

  const invalid = await authenticator.authenticate('bad-token')
  assert.equal(invalid, null)
  assert.deepEqual(observedAuthorization, ['Bearer signed-test-token', 'Bearer bad-token'])
})
