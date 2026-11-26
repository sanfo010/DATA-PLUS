# Supabase setup

The app's authentication continues to use the existing Supabase project settings
in `.env.local`. Do not commit that file. Start from `.env.example` in a new
environment and provide the project's URL and public anon/publishable key.

Run the migrations in order in the Supabase SQL editor:

1. `supabase/migrations/202611231347_create_profiles.sql`
2. `supabase/migrations/202611231430_create_wallet.sql`
3. `supabase/migrations/202611231432_profile_avatar_delete.sql`
4. `supabase/migrations/202611231700_create_devices_and_vpn_sessions.sql`
5. `supabase/migrations/202611241245_create_wireguard_device_peers_and_lab_sessions.sql`

The profile migration creates the profile row and avatar storage policies.
Avatar reads are public; uploads, updates, and deletes are limited to the
authenticated owner. If the avatar bucket is unavailable, profile photos are
resized and stored locally for that account on this browser until Supabase
storage is configured.

The wallet migration creates user-scoped wallet, reservation, and transaction
tables with row-level security. Wallet persistence is deliberately not wired to
these tables yet: the current wallet is a per-account browser development
simulation, starts at zero, and does not provide Internet access or represent
purchased/real data. It is stored under a browser-local key scoped to the
authenticated user and can be cleared from settings or by clearing this
browser's site data.
Wallet tables are read-only to end-user clients for now. Later reservation
mutations must be implemented in a trusted server-side function/API.

Before using a real wallet, move reservation mutations to a trusted server-side
function/API. Client-side RLS policies are not a substitute for validating
balances and applying ledger updates atomically on the server.

The activation experience is also a browser-local demonstration. A session is
only marked as waiting for the future network service; it never reports a real
connection. Consumption, interruption, thresholds, and activation history are
simulated in the user's local wallet record. No VPN, remote connectivity,
automatic session service, or real data debit is configured. A production
activation flow must be backed by a trusted session service and verified
network state before reporting a connection as established or debiting data.

For the network architecture audit, residential-vs-centralized egress analysis,
WireGuard/mobile constraints, cost assumptions, security requirements, and
future test plan, see [ARCHITECTURE_RESEAU.md](./ARCHITECTURE_RESEAU.md).

## Devices and control-plane sessions

The phase 6 migration adds `devices`, `vpn_sessions`, and
`vpn_session_events`. Each row is scoped to its Supabase Auth user. RLS permits
users to read their own rows; direct client writes are revoked. Authenticated
RPCs register/revoke the caller's devices, create a `requested` session with a
zero-byte reservation, and request a session stop. The browser UI exposes those
flows under Profile → My devices / DataPlus sessions.

The migration also removes default client DML grants on the existing
`wallets`, `reservations`, and `transactions` tables and restores owner-readable
`SELECT` only. Wallet mutations must be performed by a trusted server-side
function/API.

These are account records, not cryptographic device authentication. The
registration key is an idempotency key, not a WireGuard key. No private keys,
server credentials, VPN gateway, or session-control service are created here.
Only a trusted service role may record gateway usage; no such service is
deployed. A session must not be shown as connected without gateway evidence,
and clients cannot authorize a session or change its network state.

The migration has been applied through the Supabase SQL Editor to the
configured `DATAPLUS` project and its tables, columns, RLS flags, policies,
indexes, function grants, and triggers were inspected there on 2026-11-23.
This project does not expose a `supabase_migrations.schema_migrations` ledger,
so the dashboard execution is not recorded as a CLI migration version. Other
environments still need the migration run in order. Application build success
does not validate another project's schema or permissions.

The UI reports migration/network errors and keeps account data isolated when
switching users. Session requests reserve no wallet balance and do not touch
the browser's separate demo wallet. The stop action on a still-requested
session closes that request; once a trusted service has authorized a session,
the RPC changes it to `stopping` and waits for gateway confirmation.

Validation in the configured project used rollback-only SQL transactions for
the RPC and row-security checks. The project had one Auth user and no dedicated
test accounts; a second synthetic JWT subject was used only to verify owner
filtering and cross-owner RPC rejection. No rows from those tests were
committed. Tests covered device and session creation, matching idempotent
retries, mismatched idempotency payload rejection, stop/revoke behavior,
revocation blocked by an open request, invalid identifiers and null inputs,
owner-only reads and RPC mutations, direct session/wallet writes, anonymous
RPC denial, trusted meter authorization, cumulative counters, replay handling,
and zero-credit exhaustion. A final query confirmed the three tables, three
RLS policies, fifteen indexes, no device DML grants to `authenticated`, and
zero test rows after rollback.

The browser UI was checked against a real authenticated session for reading
devices/sessions and refreshing; offline requests displayed a retryable network
error. UI writes were not submitted against the only existing account, to avoid
leaving test devices or sessions in a real user's account. These SQL tests do
not replace an end-to-end run with two independent Auth accounts; use a staging
project with two throwaway users for that final check.

### Staging smoke test with two Auth users

The repository includes an opt-in RPC/RLS smoke test:

1. Use a separate Supabase staging project. Apply the migrations above in
   order and create two confirmed, disposable Auth users with distinct accounts.
2. Copy `.env.staging.local.example` to `.env.staging.local` (already ignored by
   `.gitignore`) and fill in the staging URL, publishable key, and the two
   disposable accounts locally. Never commit the filled file, paste passwords
   into chat, or use production accounts. Alternatively, set those variables
   in the terminal process:

   ```powershell
   $env:DATAPLUS_STAGING_URL = "https://<staging-project>.supabase.co"
   $env:DATAPLUS_STAGING_ANON_KEY = "<staging-publishable-key>"
   $env:DATAPLUS_STAGING_USER_A_EMAIL = "<test-user-a-email>"
   $env:DATAPLUS_STAGING_USER_A_PASSWORD = "<test-user-a-password>"
   $env:DATAPLUS_STAGING_USER_B_EMAIL = "<test-user-b-email>"
   $env:DATAPLUS_STAGING_USER_B_PASSWORD = "<test-user-b-password>"
   $env:DATAPLUS_STAGING_CONFIRM_WRITES = "I_CONFIRM_THIS_IS_STAGING"
   npm run test:phase6:staging
   ```

3. The script refuses to run without the explicit confirmation, two different
   email addresses, and a staging URL different from `VITE_SUPABASE_URL` in
   `.env.local`. It signs in both accounts, exercises device/session creation,
   idempotent retries, cross-user reads/actions, direct-write denials, and
   stop/revoke flows, then stops the created sessions, revokes the devices, and
   signs out.
4. The test intentionally uses only the public key and user passwords. It does
   not use a service-role key and cannot delete rows; stopped session records
   and revoked device records remain in staging for auditability. Use
   disposable accounts and remove the staging project after reviewing results
   if it is no longer needed.

The staging smoke test was executed successfully on 2026-11-23 against the
separate `DataPlus-Staging` project with two distinct Auth users. All 15
reported checks passed: sign-in, device/session registration, idempotent
retries, mismatched idempotency rejection, owner-only reads, cross-user
stop/revoke/request denial, blocked revocation while a request is open, direct
session and wallet write denial, and owner stop flows. The script stopped both
test sessions and revoked both test devices. Their stopped/revoked audit rows
remain in staging by design. This confirms RPC/RLS behavior with two real Auth
users; it does not validate the browser UI, a VPN tunnel, real Internet access,
or traffic billing.

The script tests Supabase RPC/RLS directly, not the browser UI. For UI checks,
start a separate local app process pointed at staging without editing
`.env.local`:

```powershell
$env:VITE_SUPABASE_URL = $env:DATAPLUS_STAGING_URL
$env:VITE_SUPABASE_ANON_KEY = $env:DATAPLUS_STAGING_ANON_KEY
npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Open the staging app in two separate browser profiles. Sign in as user A in
one and user B in the other. Under Profile → My devices / DataPlus sessions,
register a device and request then stop a session for each user. Refresh the
screens and verify each account sees only its own records, the statuses update,
and no session is reported as connected. Revoke each test device after stopping
its session. Stop the local app and clear the staging environment variables
when finished. These manual UI checks remain unexecuted and should be performed against
staging.

## Phase 7 backend

The Express/TypeScript control-plane backend and API contract are documented in
[BACKEND.md](./BACKEND.md). It verifies user JWTs through Supabase Auth and uses
the caller's token for database operations, preserving RLS. No phase 7 schema
migration is needed: the backend uses the existing profile/device/session
tables and RPCs.

To run locally, copy `.env.server.local.example` to `.env.server.local`, set
`SUPABASE_URL` and `SUPABASE_ANON_KEY`, then run `npm run dev:backend`. In
another terminal run `npm run dev`. To route the device/session UI through the
API, set `VITE_DATAPLUS_API_URL=http://localhost:3001/api/v1` in the ignored
frontend `.env.local`; leaving it unset preserves the previous direct-RLS path.
`CORS_ORIGINS` must include the frontend origin.

`SUPABASE_SERVICE_ROLE_KEY` and `GATEWAY_WEBHOOK_SECRET` are optional
server-only settings for a future real gateway. Do not set or expose them in
the frontend. Without both a real signed gateway source and these server
settings, traffic-event intake returns `503`. The WireGuard adapter is
unconfigured and all session requests remain `requested`; no quota reservation,
wallet debit, tunnel, or Internet connectivity is provided.

Run local backend tests with `npm run test:backend`. They use test
auth/data-provider doubles and a mocked Supabase Auth endpoint; they do not
authenticate against staging. `npm run build` type-checks and builds both the
frontend and backend. No new Supabase migration was applied for phase 7.

## Phase 8 local WireGuard laboratory

Ubuntu 26.04 was provisioned in WSL2 and `wireguard-tools` was installed.
The scripts `scripts/setup-wg-lab.sh`, `scripts/test-wg-lab.sh`, and
`scripts/stop-wg-lab.sh` create and stop an isolated pair with no Internet
forwarding or NAT. A real WSL WireGuard handshake and 3/3 tunnel-only pings
were executed on 2026-11-24. The test interface was stopped afterward.

Private keys remain inside WSL at `/root/dataplus-lab` with restricted
directory/file permissions. They are not copied to Git or any frontend
response. The phase 8 backend adapter is disabled unless
`DATAPLUS_WG_LAB_ENABLED=1` is set locally. Enabling it does not expose the
gateway publicly, forward Internet traffic, debit the wallet, or mark Supabase
sessions connected by itself.

## Phase 9.1 device peers and persistent lab sessions

The additive migration
`202611241245_create_wireguard_device_peers_and_lab_sessions.sql` creates
owner-scoped public peer metadata and non-billable lab session persistence.
It contains no private-key column, does not alter wallet or billable
`vpn_sessions` data, and grants writes only to `service_role`; authenticated
users receive owner-scoped reads. The backend verifies device ownership before
using its server-only service role.

The project owner confirmed that this migration is already applied to the
`DataPlus-Staging` project. A read-only dashboard inspection confirmed both
tables, their expected columns, indexes, constraints, RLS policies and
service-role grants. Do not reapply the migration. The backend's real
service-role connection and persistence across a backend restart still require
runtime validation; a database-only inspection is not proof of that behavior.

An individual device generates its private key natively and sends only its
public key to the backend. The WSL gateway and Supabase do not store the
individual device's private key. The browser configuration endpoint remains
unavailable pending a native-client configuration flow. Native enrollment is
public-key-only:
`POST /api/v1/devices/:deviceId/wireguard` accepts `public_key`; it never
receives or stores the private key. These tables do not represent real user
connectivity, wallet consumption or billing.

`npm run test:backend` includes isolated peer authorization and backend
reconstruction tests. `npm run test:wsl-device-peers` enrolls two temporary
public keys against the actual WSL WireGuard tools, checks distinct
keys/addresses and independent revocation, then removes only those test peers
and stops the newly created device interface. It does not configure a client
tunnel or change Windows routing. These local test commands do not prove
service-role persistence against staging.
