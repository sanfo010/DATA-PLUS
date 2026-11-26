create table if not exists public.wireguard_device_peers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  device_id uuid not null,
  key_version integer not null default 1 check (key_version > 0),
  public_key text not null unique
    check (public_key ~ '^[A-Za-z0-9+/]{43}=$'),
  assigned_ip inet not null unique
    check (family(assigned_ip) = 4 and assigned_ip <<= inet '10.78.0.0/24'),
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (device_id, key_version),
  unique (id, user_id, device_id),
  foreign key (device_id, user_id)
    references public.devices (id, user_id) on delete restrict,
  check ((status = 'revoked') = (revoked_at is not null))
);

create unique index if not exists wireguard_device_peers_one_active_idx
  on public.wireguard_device_peers (device_id)
  where status = 'active';
create index if not exists wireguard_device_peers_user_created_idx
  on public.wireguard_device_peers (user_id, created_at desc);

create table if not exists public.vpn_lab_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  peer_id uuid,
  gateway_mode text not null
    check (gateway_mode in ('shared_lab', 'device_peer')),
  idempotency_key uuid not null,
  status text not null default 'requested'
    check (status in (
      'requested', 'authorized', 'connecting', 'connected',
      'interrupted', 'stopping', 'stopped', 'failed'
    )),
  baseline_rx_bytes text not null default '0'
    check (baseline_rx_bytes ~ '^(0|[1-9][0-9]{0,19})$'),
  baseline_tx_bytes text not null default '0'
    check (baseline_tx_bytes ~ '^(0|[1-9][0-9]{0,19})$'),
  rx_bytes text not null default '0'
    check (rx_bytes ~ '^(0|[1-9][0-9]{0,19})$'),
  tx_bytes text not null default '0'
    check (tx_bytes ~ '^(0|[1-9][0-9]{0,19})$'),
  last_handshake_at timestamptz,
  last_observed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  stopped_at timestamptz,
  unique (user_id, idempotency_key),
  foreign key (device_id, user_id)
    references public.devices (id, user_id) on delete restrict,
  foreign key (peer_id, user_id, device_id)
    references public.wireguard_device_peers (id, user_id, device_id) on delete restrict,
  check (
    (gateway_mode = 'shared_lab' and peer_id is null)
    or (gateway_mode = 'device_peer' and peer_id is not null)
  )
);

create unique index if not exists vpn_lab_sessions_one_open_per_device_idx
  on public.vpn_lab_sessions (device_id)
  where status in ('requested', 'authorized', 'connecting', 'connected', 'interrupted', 'stopping');
create unique index if not exists vpn_lab_sessions_one_open_shared_lab_idx
  on public.vpn_lab_sessions (gateway_mode)
  where gateway_mode = 'shared_lab'
    and status in ('requested', 'authorized', 'connecting', 'connected', 'interrupted', 'stopping');
create index if not exists vpn_lab_sessions_user_created_idx
  on public.vpn_lab_sessions (user_id, created_at desc);

alter table public.wireguard_device_peers enable row level security;
alter table public.vpn_lab_sessions enable row level security;

drop policy if exists "Users can view own WireGuard device peers"
  on public.wireguard_device_peers;
create policy "Users can view own WireGuard device peers"
  on public.wireguard_device_peers for select
  using (auth.uid() = user_id);

drop policy if exists "Users can view own VPN lab sessions"
  on public.vpn_lab_sessions;
create policy "Users can view own VPN lab sessions"
  on public.vpn_lab_sessions for select
  using (auth.uid() = user_id);

revoke all on public.wireguard_device_peers, public.vpn_lab_sessions
  from anon, authenticated;
grant select on public.wireguard_device_peers, public.vpn_lab_sessions
  to authenticated;
grant all on public.wireguard_device_peers, public.vpn_lab_sessions
  to service_role;

comment on table public.wireguard_device_peers is
  'Owner-scoped public WireGuard peer metadata only. Private keys remain in the protected local gateway key store.';
comment on column public.wireguard_device_peers.public_key is
  'Public WireGuard key; no private key material is stored in Supabase.';
comment on table public.vpn_lab_sessions is
  'Persistent non-billable lab session state. Only the trusted backend service role may write records.';
