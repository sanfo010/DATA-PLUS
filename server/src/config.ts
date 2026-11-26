export type ServerConfig = {
  port: number
  supabaseUrl: string
  supabaseAnonKey: string
  supabaseServiceRoleKey?: string
  allowedOrigins: string[]
  gatewayWebhookSecret?: string
  wireGuardLabEnabled?: boolean
  wireGuardDevicesEnabled?: boolean
  wireGuardSessionPersistenceEnabled?: boolean
  wireGuardDeviceEndpoint?: string
}

function parseWireGuardEndpoint(value: string | undefined): string | undefined {
  const endpoint = value?.trim()
  if (!endpoint) return undefined
  const match = endpoint.match(/^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/)
  const port = match ? Number(match[1]) : 0
  if (!match || port < 1 || port > 65535) {
    throw new Error('DATAPLUS_WG_DEVICE_ENDPOINT must be a host:port endpoint.')
  }
  return endpoint
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const supabaseUrl = env.SUPABASE_URL?.trim()
  const supabaseAnonKey = env.SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required.')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(supabaseUrl)
  } catch {
    throw new Error('SUPABASE_URL must be a valid URL.')
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost') {
    throw new Error('SUPABASE_URL must use HTTPS except for localhost.')
  }

  const port = Number(env.PORT ?? '3001')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.')
  }

  const gatewayWebhookSecret = env.GATEWAY_WEBHOOK_SECRET?.trim() || undefined
  if (gatewayWebhookSecret && Buffer.byteLength(gatewayWebhookSecret) < 32) {
    throw new Error('GATEWAY_WEBHOOK_SECRET must be at least 32 bytes.')
  }
  const wireGuardLabEnabled = env.DATAPLUS_WG_LAB_ENABLED === '1'
  const wireGuardDevicesEnabled = env.DATAPLUS_WG_DEVICES_ENABLED === '1'
  const wireGuardSessionPersistenceEnabled = env.DATAPLUS_WG_SESSION_PERSISTENCE === '1'
  const wireGuardDeviceEndpoint = parseWireGuardEndpoint(env.DATAPLUS_WG_DEVICE_ENDPOINT)
  if (
    (wireGuardLabEnabled || wireGuardDevicesEnabled || wireGuardSessionPersistenceEnabled)
    && env.NODE_ENV === 'production'
  ) {
    throw new Error('WireGuard laboratory features are restricted to local laboratory environments.')
  }
  if (wireGuardSessionPersistenceEnabled && !wireGuardLabEnabled) {
    throw new Error('DATAPLUS_WG_SESSION_PERSISTENCE requires DATAPLUS_WG_LAB_ENABLED=1.')
  }
  const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined
  if ((wireGuardDevicesEnabled || wireGuardSessionPersistenceEnabled) && !supabaseServiceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for persistent WireGuard lab data.')
  }

  return {
    port,
    supabaseUrl: parsedUrl.toString().replace(/\/$/, ''),
    supabaseAnonKey,
    supabaseServiceRoleKey,
    allowedOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    gatewayWebhookSecret,
    wireGuardLabEnabled,
    wireGuardDevicesEnabled,
    wireGuardSessionPersistenceEnabled,
    wireGuardDeviceEndpoint,
  }
}
