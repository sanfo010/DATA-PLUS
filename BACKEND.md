# DataPlus central backend — phase 7

## Status and boundaries

The Node.js/Express API is implemented in TypeScript under `server/src`. It is
the optional control-plane intermediary for the device and session screens.
The existing Supabase Auth flow and demo wallet are unchanged.

The backend validates Supabase access tokens with `auth.getUser(token)`. It
then creates a Supabase client carrying that user's bearer token, so database
reads and RPC calls continue to run under the authenticated role and existing
RLS policies. The API does not accept a client-supplied user ID. It does not
use a service-role key for user operations.

Regular DataPlus VPN session requests still create only a zero-byte
`requested` Supabase row. They do not control WireGuard and cannot become
connected through the laboratory API. The opt-in local lab uses a separate
registry; it can remain in memory or be persisted to the non-billable lab
tables when explicitly enabled. It never writes to `vpn_sessions` or changes
the wallet.

## API

All responses use `{ "data": ... }`; errors use `{ "error": { "code",
"message", "request_id" } }`.

| Method and path | Authentication | Purpose |
|---|---|---|
| `GET /health` | None | Process health only; not a Supabase or VPN health check |
| `GET /api/v1/capabilities` | None | Reports configured local-lab capabilities and disabled wallet writes |
| `GET /api/v1/me` | Supabase bearer token | Verified user ID/email and owner-scoped profile |
| `GET /api/v1/devices` | Supabase bearer token | List only the caller's devices |
| `POST /api/v1/devices` | Supabase bearer token | Register an account device through the existing RPC |
| `POST /api/v1/devices/:deviceId/revoke` | Supabase bearer token | Revoke only a device owned by the caller |
| `GET /api/v1/devices/wireguard` | Supabase bearer token | List only the caller's public WireGuard peer metadata |
| `GET /api/v1/devices/:deviceId/wireguard` | Supabase bearer token | Inspect that owner's public WireGuard identity and local peer status |
| `POST /api/v1/devices/:deviceId/wireguard` | Supabase bearer token | Enroll one public key; private key remains on the native device |
| `POST /api/v1/devices/:deviceId/wireguard/revoke` | Supabase bearer token | Revoke that device's peer without revoking other peers |
| `GET /api/v1/devices/:deviceId/wireguard/configuration` | Supabase bearer token | Deliberately unavailable until secure native-client enrollment exists |
| `GET /api/v1/sessions` | Supabase bearer token | List only the caller's recent sessions |
| `POST /api/v1/sessions` | Supabase bearer token | Create an idempotent `requested` session with no quota reservation |
| `GET /api/v1/sessions/:sessionId` | Supabase bearer token | Read a session belonging to the caller |
| `POST /api/v1/sessions/:sessionId/stop` | Supabase bearer token | Ask the existing owner-scoped RPC to stop the session |
| `GET /api/v1/lab/gateway` | Supabase bearer token | Inspect local lab availability, handshake and real peer counters |
| `GET /api/v1/lab/sessions/current` | Supabase bearer token | Read the caller's current lab session, if any |
| `POST /api/v1/lab/sessions/reconcile` | Supabase bearer token | Reconcile the caller's restored lab sessions against gateway evidence |
| `POST /api/v1/lab/sessions` | Supabase bearer token | Start a local tunnel for one active owned device |
| `GET /api/v1/lab/sessions/:sessionId` | Supabase bearer token | Read only the caller's lab session and refresh real measurements |
| `POST /api/v1/lab/sessions/:sessionId/stop` | Supabase bearer token | Stop the WSL lab and verify its interface is gone |
| `POST /internal/v1/gateway/events` | HMAC signature | Ingest a future signed cumulative traffic event; disabled until configured |

The local lab routes are mounted only when `DATAPLUS_WG_LAB_ENABLED=1`, and
configuration refuses to enable them in `NODE_ENV=production`. The backend
uses fixed `wsl.exe` arguments and fixed script names; user values never become
shell arguments. Operations are serialized and permit only one global lab
session at a time. Device ownership is checked through the authenticated Supabase context, other
users' session IDs are hidden as `404`, and an untracked active interface
blocks a new start. Lab sessions are in memory by default and are lost when
the backend restarts.

Revoking an account device first stops an active shared-lab session owned by
that device, revokes its individual `wgdpdev0` peer when the device-peer
feature is enabled, and then invokes the existing owner-scoped Supabase
revocation. The historical shared WSL lab client remains a shared internal
test peer; it is not the per-account device identity. Stopping that old lab
interface leaves its protected test key files for the next local run.

## Phase 9.1 — individual device peers and persistence

The separate `DATAPLUS_WG_DEVICES_ENABLED=1` opt-in uses
`wgdpdev0` and fixed WSL scripts under `scripts/`. A native device generates
its own WireGuard identity and sends only its public key. The gateway stores
public peer metadata under `/root/dataplus-lab/devices` with directories mode
`0700`; it never generates or stores an individual device's private key.
Supabase stores only the public key, allocated private-range address, status
and key version. The server key and the historical shared-lab test keys remain
separate; the original shared lab interface and scripts are unchanged.

Peer routes always verify the Supabase bearer identity and resolve the device
through that user's device list. The service role is used only server-side for
the new lab metadata repository. No peer can be marked connected by
provisioning. Native enrollment sends only `{"public_key":"..."}` to
`POST /api/v1/devices/:deviceId/wireguard`; the private key is generated and
kept on the native device. The web configuration endpoint returns `501
native_enrollment_required`; no private configuration is served. Revoked keys
cannot be silently regenerated; rotation remains a future operation.

For the shared lab only, `DATAPLUS_WG_SESSION_PERSISTENCE=1` persists session
metadata and known counters in `vpn_lab_sessions`. It requires
`DATAPLUS_WG_LAB_ENABLED=1`, `SUPABASE_SERVICE_ROLE_KEY`, and the additive phase
9.1 migration. On backend startup the manager reloads open sessions and marks
them `connected` only when the gateway confirms a fresh handshake; missing
proof is reconciled as `interrupted`. Counter baselines are rebased after a
restart, preserving known totals without counting the same gateway bytes
twice. Multiple persisted open shared-lab sessions cause a visible
reconciliation error; peers are never deleted automatically.

These features are local-lab-only and refused in production. The API binds to
`127.0.0.1` when the shared or device gateway is enabled. No real Internet,
wallet debit, billing, client configuration, or physical-device handshake is
provided.

Session creation accepts only:

```json
{
  "device_id": "UUID",
  "idempotency_key": "UUID"
}
```

Unknown fields (including `user_id`) are rejected. Device registration accepts
`device_name`, `platform`, and `idempotency_key`. The database RPC derives the
owner from the verified JWT, checks device ownership, and enforces idempotency.

The backend applies Helmet headers, a fixed CORS origin allowlist, a 32 KiB JSON
body limit, request-rate limiting, UUID and payload validation, centralized
sanitized errors, and access logs that omit request bodies, tokens, and query
strings.

## Supabase setup

Copy `.env.server.local.example` to `.env.server.local` and set `SUPABASE_URL`
and the project's public/publishable `SUPABASE_ANON_KEY`. This server config is
separate from the frontend's `VITE_*` variables. Do not copy secrets into
frontend variables.

The local phase 9.1 lab requires `SUPABASE_SERVICE_ROLE_KEY` for the optional
peer/session metadata repository. Set it only in the backend process or a
server-only secret store; it is never returned by an API route. The webhook
requires a separate randomly generated `GATEWAY_WEBHOOK_SECRET` of at least 32
bytes, a timestamp within five minutes and an HMAC-SHA256 signature:

```text
X-DataPlus-Timestamp: <unix-seconds>
X-DataPlus-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + raw-request-body)>
```

Traffic byte counts and sequence numbers are decimal integer strings to avoid
JavaScript number precision loss. The database RPC locks the session, checks
monotonic cumulative counters and idempotent event IDs/sequences, and records
the measured delta. No gateway currently sends these events, so the endpoint
returns `503` unless both server-only settings are configured.

## WireGuard boundary

`server/src/gateway.ts` defines the future gateway contract:

- authorize/revoke an account device;
- create a connection configuration;
- start, inspect, and stop a session.

The default `UnconfiguredWireGuardGateway` rejects every operation with `503`.
It intentionally creates no keys, configurations, peers, or sessions. A future
adapter must authenticate backend-to-gateway calls with mutual TLS or a
rotatable service credential, validate gateway responses, and persist the
verified evidence before the database can accept `connected`.

A local adapter is available in `server/src/gateway-local-wsl.ts`. It controls
only the Ubuntu WSL distribution through fixed scripts and reads the public
peer key, real handshake timestamp, endpoint and WireGuard transfer counters.
Private keys remain in WSL under `/root/dataplus-lab`. Enable it only in a local
lab with `DATAPLUS_WG_LAB_ENABLED=1`; it is disabled by default and rejected in
production. When enabled, the API binds to `127.0.0.1`. The lab uses only
private `10.77.0.0/24` and `10.88.0.0/30`
addresses and does not forward Internet traffic. The fixed client peer is an
internal test client, not the user's physical device; the account device is
ownership authorization only.

The Sessions screen labels the separate feature **« Laboratoire VPN —
connexion de test uniquement »**. RX/TX values are real WireGuard counters
measured relative to lab-session start; they are not wallet consumption,
Internet traffic or billable bytes. Starting runs a fixed private-address ping
to prompt a handshake. Stop is successful only after the backend observes that
the WireGuard interface is gone.

## Quota and wallet safety

The API never accepts traffic counters from a user route and has no wallet
mutation route. Gateway traffic can only arrive at the HMAC-protected internal
endpoint and is passed to the existing service-role RPC. Session requests keep
`reserved_bytes = 0`; they cannot progress to `connected` under the current
database constraints.

**This is not yet a hard quota enforcement system.** The current usage RPC
records real gateway counters and moves an exhausted connected session toward
`stopping`, but the gateway must enforce an immediate packet-level cutoff. A
production quota requires an atomic server-side reservation, measured event
reconciliation, a defined overrun policy, and a tested gateway cutoff. This
phase deliberately adds none of those financial mutations.

## Frontend integration

The DataPlus devices and sessions screens use the API when
`VITE_DATAPLUS_API_URL` is set, for example:

```dotenv
VITE_DATAPLUS_API_URL=http://localhost:3001/api/v1
```

When unset, the screens retain their existing direct Supabase/RLS behavior.
Authentication and the browser-local demonstration wallet continue to use
their existing code paths. No design changes are required.

## Local development and tests

1. Install dependencies with `npm install`.
2. Copy `.env.server.local.example` to `.env.server.local` and set the
   Supabase URL and public/publishable key.
3. In one terminal run `npm run dev:backend`.
4. In another terminal run `npm run dev`. Set `VITE_DATAPLUS_API_URL` in the
   frontend's ignored `.env.local` only if you want its device/session screens
   to use the backend. `CORS_ORIGINS` must contain the frontend origin.
   For the shared WSL lab, set `DATAPLUS_WG_LAB_ENABLED=1`. For persistent
   sessions also set `DATAPLUS_WG_SESSION_PERSISTENCE=1`. For individual lab
   peers set `DATAPLUS_WG_DEVICES_ENABLED=1`. The latter two require the
   server-only service role key and the phase 9.1 migration. Ensure Ubuntu WSL
   and `wireguard-tools` are available; never expose the backend publicly.
5. Run `npm run test:backend` for local tests and `npm run build` for both
   frontend and backend compilation.

Local tests use an injected test authenticator/data service and a mocked
Supabase Auth HTTP response. They verify route authorization and input
validation, not the cryptographic validation of a real staging JWT. The
separate phase 6 staging smoke test exercises Supabase/RLS with two real Auth
accounts. `npm run test:backend` includes isolated peer-ownership and simulated
backend-restart tests; the real two-peer WSL test is available as
`npm run test:wsl-device-peers`. No staging Supabase calls are required by the
backend test suite, and the phase 9.1 migration has not been applied remotely.
