create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  available_mb bigint not null default 0 check (available_mb >= 0),
  reserved_mb bigint not null default 0 check (reserved_mb >= 0),
  consumed_mb bigint not null default 0 check (consumed_mb >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid not null,
  amount_mb bigint not null check (amount_mb > 0),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled', 'failed')),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (wallet_id, user_id)
    references public.wallets (id, user_id) on delete cascade
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid not null,
  reservation_id uuid,
  kind text not null check (kind in ('reservation', 'activation', 'consumption', 'cancellation')),
  amount_mb bigint not null check (amount_mb > 0),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'cancelled', 'failed')),
  description text not null default '',
  created_at timestamptz not null default now(),
  foreign key (wallet_id, user_id)
    references public.wallets (id, user_id) on delete cascade,
  foreign key (reservation_id, user_id)
    references public.reservations (id, user_id)
);

alter table public.wallets enable row level security;
alter table public.reservations enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "Users can view own wallet" on public.wallets;
create policy "Users can view own wallet"
  on public.wallets for select
  using (auth.uid() = user_id);

drop policy if exists "Users can view own reservations" on public.reservations;
create policy "Users can view own reservations"
  on public.reservations for select
  using (auth.uid() = user_id);

drop policy if exists "Users can view own transactions" on public.transactions;
create policy "Users can view own transactions"
  on public.transactions for select
  using (auth.uid() = user_id);

create index if not exists reservations_user_created_idx
  on public.reservations (user_id, created_at desc);
create index if not exists transactions_user_created_idx
  on public.transactions (user_id, created_at desc);
