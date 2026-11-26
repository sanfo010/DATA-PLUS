create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_name text not null check (char_length(btrim(device_name)) between 2 and 60),
  platform text not null default 'web'
    check (platform in ('web', 'android', 'ios', 'unknown')),
  status text not null default 'active'
    check (status in ('active', 'inactive', 'revoked')),
  registration_key uuid not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  unique (id, user_id),
  unique (user_id, registration_key),
  check ((status = 'revoked') = (revoked_at is not null))
);

create index if not exists devices_user_created_idx
  on public.devices (user_id, created_at desc);
create index if not exists devices_user_status_idx
  on public.devices (user_id, status);

create table if not exists public.vpn_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  idempotency_key uuid not null,
  status text not null default 'requested'
    check (status in (
      'requested', 'authorized', 'connecting', 'connected',
      'interrupted', 'stopping', 'stopped', 'failed'
    )),
  reserved_bytes bigint not null default 0 check (reserved_bytes >= 0),
  consumed_bytes bigint not null default 0 check (consumed_bytes >= 0),
  remaining_bytes bigint generated always as (greatest(reserved_bytes - consumed_bytes, 0)) stored,
  last_rx_bytes bigint not null default 0 check (last_rx_bytes >= 0),
  last_tx_bytes bigint not null default 0 check (last_tx_bytes >= 0),
  last_gateway_sequence bigint not null default 0 check (last_gateway_sequence >= 0),
  gateway_session_ref text,
  gateway_event_id uuid,
  gateway_verified_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  stopped_at timestamptz,
  unique (id, user_id),
  unique (user_id, idempotency_key),
  foreign key (device_id, user_id)
    references public.devices (id, user_id) on delete restrict,
  check (
    status <> 'connected'
    or (
      reserved_bytes > 0
      and started_at is not null
      and gateway_session_ref is not null
      and gateway_event_id is not null
      and gateway_verified_at is not null
    )
  )
);

create unique index if not exists vpn_sessions_one_open_per_user_idx
  on public.vpn_sessions (user_id)
  where status in ('requested', 'authorized', 'connecting', 'connected', 'interrupted', 'stopping');
create index if not exists vpn_sessions_user_created_idx
  on public.vpn_sessions (user_id, created_at desc);
create index if not exists vpn_sessions_device_created_idx
  on public.vpn_sessions (device_id, created_at desc);

create table if not exists public.vpn_session_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  event_type text not null
    check (event_type in ('session_requested', 'status_changed', 'traffic_metered')),
  from_status text,
  to_status text,
  gateway_event_id uuid,
  gateway_sequence bigint,
  rx_bytes bigint,
  tx_bytes bigint,
  delta_bytes bigint,
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id)
    references public.vpn_sessions (id, user_id) on delete cascade,
  check (
    (event_type = 'traffic_metered'
      and gateway_event_id is not null
      and gateway_sequence is not null
      and rx_bytes is not null
      and tx_bytes is not null
      and delta_bytes is not null)
    or
    (event_type <> 'traffic_metered'
      and gateway_event_id is null
      and gateway_sequence is null
      and rx_bytes is null
      and tx_bytes is null
      and delta_bytes is null)
  )
);

create unique index if not exists vpn_session_events_gateway_id_idx
  on public.vpn_session_events (gateway_event_id)
  where gateway_event_id is not null;
create unique index if not exists vpn_session_events_sequence_idx
  on public.vpn_session_events (session_id, gateway_sequence)
  where gateway_sequence is not null;
create index if not exists vpn_session_events_user_created_idx
  on public.vpn_session_events (user_id, created_at desc);

alter table public.devices enable row level security;
alter table public.vpn_sessions enable row level security;
alter table public.vpn_session_events enable row level security;

drop policy if exists "Users can view own devices" on public.devices;
create policy "Users can view own devices"
  on public.devices for select
  using (auth.uid() = user_id);

drop policy if exists "Users can view own VPN sessions" on public.vpn_sessions;
create policy "Users can view own VPN sessions"
  on public.vpn_sessions for select
  using (auth.uid() = user_id);

drop policy if exists "Users can view own VPN session events" on public.vpn_session_events;
create policy "Users can view own VPN session events"
  on public.vpn_session_events for select
  using (auth.uid() = user_id);

revoke all on public.devices, public.vpn_sessions, public.vpn_session_events
  from anon, authenticated;
grant select on public.devices, public.vpn_sessions, public.vpn_session_events
  to authenticated;
grant all on public.devices, public.vpn_sessions, public.vpn_session_events
  to service_role;

revoke all on public.wallets, public.reservations, public.transactions
  from anon, authenticated;
grant select on public.wallets, public.reservations, public.transactions
  to authenticated;

create or replace function public.guard_vpn_session_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.user_id <> old.user_id
    or new.device_id <> old.device_id
    or new.idempotency_key <> old.idempotency_key
    or new.created_at <> old.created_at then
    raise exception using errcode = '22000', message = 'Session ownership and identity are immutable';
  end if;

  if new.consumed_bytes < old.consumed_bytes
    or new.last_rx_bytes < old.last_rx_bytes
    or new.last_tx_bytes < old.last_tx_bytes
    or new.last_gateway_sequence < old.last_gateway_sequence then
    raise exception using errcode = '22000', message = 'Session counters cannot decrease';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'requested' and new.status in ('authorized', 'stopped', 'failed'))
    or (old.status = 'authorized' and new.status in ('connecting', 'stopping', 'failed'))
    or (old.status = 'connecting' and new.status in ('connected', 'interrupted', 'stopping', 'failed'))
    or (old.status = 'connected' and new.status in ('interrupted', 'stopping', 'failed'))
    or (old.status = 'interrupted' and new.status in ('connecting', 'stopping', 'failed'))
    or (old.status = 'stopping' and new.status in ('stopped', 'failed'))
  ) then
    raise exception using errcode = '22000', message = 'Invalid VPN session state transition';
  end if;

  if new.status in ('authorized', 'connecting', 'connected')
    and new.reserved_bytes <= 0 then
    raise exception using errcode = '22000', message = 'A positive server-side credit reservation is required';
  end if;

  if new.status = 'connected'
    and (
      new.started_at is null
      or new.gateway_session_ref is null
      or new.gateway_event_id is null
      or new.gateway_verified_at is null
    ) then
    raise exception using errcode = '22000', message = 'Verified gateway evidence is required before connecting';
  end if;

  if new.status = 'stopped' and new.stopped_at is null then
    new.stopped_at := now();
  end if;

  return new;
end;
$$;

create or replace function public.log_vpn_session_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.vpn_session_events (user_id, session_id, event_type, to_status)
    values (new.user_id, new.id, 'session_requested', new.status);
  elsif new.status is distinct from old.status then
    insert into public.vpn_session_events (user_id, session_id, event_type, from_status, to_status)
    values (new.user_id, new.id, 'status_changed', old.status, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists vpn_sessions_guard_update on public.vpn_sessions;
create trigger vpn_sessions_guard_update
  before update on public.vpn_sessions
  for each row execute function public.guard_vpn_session_update();

drop trigger if exists vpn_sessions_log_events on public.vpn_sessions;
create trigger vpn_sessions_log_events
  after insert or update on public.vpn_sessions
  for each row execute function public.log_vpn_session_event();

create or replace function public.register_dataplus_device(
  p_device_name text,
  p_platform text,
  p_registration_key uuid
)
returns public.devices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_device public.devices;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_device_name is null or char_length(btrim(p_device_name)) not between 2 and 60 then
    raise exception using errcode = '22023', message = 'Device name must be between 2 and 60 characters';
  end if;
  if p_platform is null or p_platform not in ('web', 'android', 'ios', 'unknown') then
    raise exception using errcode = '22023', message = 'Unsupported device platform';
  end if;
  if p_registration_key is null then
    raise exception using errcode = '22023', message = 'Registration idempotency key is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select * into v_device
  from public.devices
  where user_id = v_user_id and registration_key = p_registration_key;
  if found then
    if v_device.device_name is distinct from btrim(p_device_name)
      or v_device.platform is distinct from p_platform then
      raise exception using errcode = '22000', message = 'Registration key was reused with different device details';
    end if;
    return v_device;
  end if;

  if (select count(*) from public.devices where user_id = v_user_id and status <> 'revoked') >= 10 then
    raise exception using errcode = '54000', message = 'Device limit reached';
  end if;

  insert into public.devices (user_id, device_name, platform, registration_key)
  values (v_user_id, btrim(p_device_name), p_platform, p_registration_key)
  returning * into v_device;

  return v_device;
end;
$$;

create or replace function public.revoke_dataplus_device(p_device_id uuid)
returns public.devices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_device public.devices;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));
  select * into v_device
  from public.devices
  where id = p_device_id and user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Device not found';
  end if;

  if exists (
    select 1 from public.vpn_sessions
    where device_id = v_device.id
      and user_id = v_user_id
      and status in ('requested', 'authorized', 'connecting', 'connected', 'interrupted', 'stopping')
  ) then
    raise exception using errcode = '55000', message = 'Stop the device session before revoking this device';
  end if;

  if v_device.status <> 'revoked' then
    update public.devices
    set status = 'revoked', revoked_at = now()
    where id = v_device.id
    returning * into v_device;
  end if;
  return v_device;
end;
$$;

create or replace function public.request_dataplus_session(
  p_device_id uuid,
  p_idempotency_key uuid
)
returns public.vpn_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_device public.devices;
  v_session public.vpn_sessions;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'Idempotency key is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select * into v_session
  from public.vpn_sessions
  where user_id = v_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_session.device_id is distinct from p_device_id then
      raise exception using errcode = '22000', message = 'Session idempotency key was reused for a different device';
    end if;
    return v_session;
  end if;

  select * into v_device
  from public.devices
  where id = p_device_id and user_id = v_user_id and status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'An active device owned by this account is required';
  end if;

  if exists (
    select 1 from public.vpn_sessions
    where user_id = v_user_id
      and status in ('requested', 'authorized', 'connecting', 'connected', 'interrupted', 'stopping')
  ) then
    raise exception using errcode = '55000', message = 'This account already has an open session';
  end if;

  insert into public.vpn_sessions (user_id, device_id, idempotency_key)
  values (v_user_id, v_device.id, p_idempotency_key)
  returning * into v_session;
  return v_session;
end;
$$;

create or replace function public.request_dataplus_session_stop(p_session_id uuid)
returns public.vpn_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.vpn_sessions;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));
  select * into v_session
  from public.vpn_sessions
  where id = p_session_id and user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Session not found';
  end if;

  if v_session.status = 'requested' then
    update public.vpn_sessions
    set status = 'stopped', stopped_at = now()
    where id = v_session.id
    returning * into v_session;
  elsif v_session.status in ('authorized', 'connecting', 'connected', 'interrupted') then
    update public.vpn_sessions
    set status = 'stopping'
    where id = v_session.id
    returning * into v_session;
  end if;

  return v_session;
end;
$$;

create or replace function public.record_vpn_session_usage(
  p_session_id uuid,
  p_gateway_event_id uuid,
  p_sequence bigint,
  p_rx_bytes bigint,
  p_tx_bytes bigint
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.vpn_sessions;
  v_previous_event public.vpn_session_events;
  v_delta bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted gateway service required';
  end if;
  if p_session_id is null
    or p_gateway_event_id is null
    or p_sequence is null
    or p_rx_bytes is null
    or p_tx_bytes is null
    or p_sequence <= 0
    or p_rx_bytes < 0
    or p_tx_bytes < 0 then
    raise exception using errcode = '22023', message = 'Invalid gateway usage event';
  end if;

  select * into v_previous_event
  from public.vpn_session_events
  where gateway_event_id = p_gateway_event_id;
  if found then
    if v_previous_event.session_id <> p_session_id
      or v_previous_event.gateway_sequence is distinct from p_sequence
      or v_previous_event.rx_bytes is distinct from p_rx_bytes
      or v_previous_event.tx_bytes is distinct from p_tx_bytes then
      raise exception using errcode = '22000', message = 'Gateway event id was replayed with different session or counter data';
    end if;
    return 0;
  end if;

  select * into v_session
  from public.vpn_sessions
  where id = p_session_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Session not found';
  end if;
  if v_session.gateway_verified_at is null
    or v_session.status not in ('connected', 'interrupted', 'stopping', 'stopped') then
    raise exception using errcode = '55000', message = 'Verified tunnel session is required before metering';
  end if;
  if p_sequence <= v_session.last_gateway_sequence
    or p_rx_bytes < v_session.last_rx_bytes
    or p_tx_bytes < v_session.last_tx_bytes then
    raise exception using errcode = '22000', message = 'Gateway counters must increase monotonically';
  end if;

  v_delta := (p_rx_bytes - v_session.last_rx_bytes) + (p_tx_bytes - v_session.last_tx_bytes);

  insert into public.vpn_session_events (
    user_id, session_id, event_type, gateway_event_id, gateway_sequence,
    rx_bytes, tx_bytes, delta_bytes
  )
  values (
    v_session.user_id, v_session.id, 'traffic_metered', p_gateway_event_id, p_sequence,
    p_rx_bytes, p_tx_bytes, v_delta
  );

  update public.vpn_sessions
  set last_rx_bytes = p_rx_bytes,
      last_tx_bytes = p_tx_bytes,
      last_gateway_sequence = p_sequence,
      consumed_bytes = consumed_bytes + v_delta,
      status = case
        when status = 'connected' and consumed_bytes + v_delta >= reserved_bytes then 'stopping'
        else status
      end
  where id = v_session.id;

  return v_delta;
end;
$$;

revoke all on function public.guard_vpn_session_update() from public, anon, authenticated;
revoke all on function public.log_vpn_session_event() from public, anon, authenticated;
revoke all on function public.register_dataplus_device(text, text, uuid) from public, anon, authenticated;
revoke all on function public.revoke_dataplus_device(uuid) from public, anon, authenticated;
revoke all on function public.request_dataplus_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.request_dataplus_session_stop(uuid) from public, anon, authenticated;
revoke all on function public.record_vpn_session_usage(uuid, uuid, bigint, bigint, bigint) from public, anon, authenticated;

grant execute on function public.register_dataplus_device(text, text, uuid) to authenticated;
grant execute on function public.revoke_dataplus_device(uuid) to authenticated;
grant execute on function public.request_dataplus_session(uuid, uuid) to authenticated;
grant execute on function public.request_dataplus_session_stop(uuid) to authenticated;
grant execute on function public.record_vpn_session_usage(uuid, uuid, bigint, bigint, bigint) to service_role;

comment on table public.devices is
  'Account-scoped device registry. Registration is not cryptographic device authentication; no WireGuard keys are stored.';
comment on table public.vpn_sessions is
  'Control-plane session requests. Client RPCs can request and stop; only trusted backend operations may authorize or verify a connection.';
comment on table public.vpn_session_events is
  'Owner-readable session audit events and trusted gateway cumulative-byte measurements.';
comment on column public.vpn_sessions.reserved_bytes is
  'Server-reserved quota in bytes. Remains zero until a trusted wallet reservation service exists.';
comment on column public.vpn_sessions.gateway_verified_at is
  'Must be set only after the trusted backend has verified real gateway and route evidence.';
comment on function public.request_dataplus_session(uuid, uuid) is
  'Creates a requested control-plane record only. It reserves no credit and does not start a VPN tunnel.';
comment on function public.record_vpn_session_usage(uuid, uuid, bigint, bigint, bigint) is
  'Trusted-service-only cumulative gateway meter. The caller must validate the authenticated gateway event before invoking it.';
