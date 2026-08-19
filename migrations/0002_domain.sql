-- abacus domain schema.
-- Migration 0001 is the Better Auth generated schema (auth_user, auth_session, ...):
-- domain tables reference auth_user(id), so 0001 must run first.
-- All amounts are positive; direction always comes from source/target endpoints.
-- V1 is EUR-only but every amount carries its currency so multi-currency needs no migration.

create table activity (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  name text not null,
  created_at timestamptz not null default now()
);
create unique index activity_user_name on activity (user_id, lower(name));

create table category (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  name text not null,
  group_label text,
  created_at timestamptz not null default now()
);
create unique index category_user_name on category (user_id, lower(name));

create table actor (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  name text not null,
  activity_id uuid references activity(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index actor_user_name on actor (user_id, lower(name));

create table actor_alias (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  actor_id uuid not null references actor(id) on delete cascade,
  alias text not null
);
-- Aliases must be unambiguous per user, across all actors.
create unique index actor_alias_user_alias on actor_alias (user_id, lower(alias));

create table account (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  name text not null,
  institution text,
  -- What the account can do: 'payment' carries movements, 'savings' carries
  -- movements at low volume, 'investment' additionally carries operations/positions.
  behavior text not null check (behavior in ('payment', 'savings', 'investment')),
  currency char(3) not null default 'EUR',
  opened_on date,
  closed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index account_user_name on account (user_id, lower(name));

create table commitment (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  kind text not null check (kind in ('subscription', 'financing')),
  label text not null,
  actor_id uuid not null references actor(id),
  account_id uuid not null references account(id),
  category_id uuid references category(id),
  activity_id uuid references activity(id),
  -- Current amount of one installment / one period. History lives in commitment_event.
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null default 'EUR',
  period_unit text not null check (period_unit in ('week', 'month', 'year')),
  period_count integer not null default 1 check (period_count > 0),
  -- Next expected occurrence; confirming or skipping an occurrence advances it.
  next_due_on date not null,
  -- Subscription-only.
  judgment text check (judgment in ('essential', 'reducible', 'to_cancel')),
  judgment_note text,
  engaged_until date,
  cancelled_on date,
  -- Financing-only. Progress and remaining due are derived from linked movements.
  installments_total integer check (installments_total > 0),
  total_amount numeric(12,2) check (total_amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'financing' or (installments_total is not null and total_amount is not null)),
  check (kind <> 'subscription' or (installments_total is null and total_amount is null)),
  check (kind <> 'financing' or (judgment is null and engaged_until is null))
);
create index commitment_user_due on commitment (user_id, next_due_on);

-- Dated audit trail of a commitment's life. Current state stays on commitment;
-- both are written in the same transaction by the service layer.
create table commitment_event (
  id uuid primary key default gen_random_uuid(),
  commitment_id uuid not null references commitment(id) on delete cascade,
  occurred_on date not null,
  type text not null check (type in ('created', 'price_changed', 'judgment_changed', 'cancelled')),
  amount numeric(12,2),
  note text,
  created_at timestamptz not null default now()
);
create index commitment_event_commitment on commitment_event (commitment_id, occurred_on);

create table balance_check (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  account_id uuid not null references account(id),
  checked_on date not null,
  declared_balance numeric(12,2) not null,
  -- Snapshot of what the app computed at check time; the gap is derived.
  -- Kept because later edits to movements change the recomputed history.
  computed_balance numeric(12,2) not null,
  note text,
  created_at timestamptz not null default now()
);
create index balance_check_account on balance_check (account_id, checked_on desc);

create table movement (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  happened_on date not null,
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null default 'EUR',
  -- Exactly one source and one target; at least one side is an owned account.
  source_account_id uuid references account(id),
  source_actor_id uuid references actor(id),
  target_account_id uuid references account(id),
  target_actor_id uuid references actor(id),
  -- Derived nature: internal transfers are neutral by construction.
  kind text not null generated always as (
    case
      when source_account_id is not null and target_account_id is not null then 'transfer'
      when source_account_id is not null then 'expense'
      else 'income'
    end
  ) stored,
  category_id uuid references category(id),
  -- Copied from the actor's activity at write time unless explicitly set.
  -- Reclassifying history is an explicit bulk action, never an implicit side effect.
  activity_id uuid references activity(id),
  note text,
  -- Origin links: occurrence of a commitment, or adjustment created from a balance check.
  commitment_id uuid references commitment(id),
  balance_check_id uuid references balance_check(id),
  -- Advance/refund tracking (spec: "Avance et remboursement").
  expected_refund_from_actor_id uuid references actor(id),
  refund_closed boolean not null default false,
  refunds_movement_id uuid references movement(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(source_account_id, source_actor_id) = 1),
  check (num_nonnulls(target_account_id, target_actor_id) = 1),
  check (source_account_id is not null or target_account_id is not null),
  -- Transfers carry no category.
  check (source_account_id is null or target_account_id is null or category_id is null),
  -- An advance is an expense; a refund link is an income.
  check (expected_refund_from_actor_id is null
         or (source_account_id is not null and target_actor_id is not null)),
  check (refunds_movement_id is null
         or (source_actor_id is not null and target_account_id is not null)),
  check (refund_closed = false or expected_refund_from_actor_id is not null)
);
create index movement_user_date on movement (user_id, happened_on desc);
create index movement_source_account on movement (source_account_id) where source_account_id is not null;
create index movement_target_account on movement (target_account_id) where target_account_id is not null;
create index movement_commitment on movement (commitment_id) where commitment_id is not null;
create index movement_refunds on movement (refunds_movement_id) where refunds_movement_id is not null;

-- Investments (V2 features, schema laid out now to avoid a structural migration).
-- Cash in/out of an investment account is a regular movement (transfer);
-- operations only cover the asset side within the account.

create table asset (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  kind text not null check (kind in ('security', 'crypto', 'currency')),
  name text not null,
  symbol text,
  isin text,
  price_source text not null check (price_source in ('yahoo', 'boursorama', 'coingecko', 'manual')),
  price_source_ref text,
  currency char(3) not null default 'EUR',
  created_at timestamptz not null default now()
);
create unique index asset_user_name on asset (user_id, lower(name));

create table investment_operation (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  account_id uuid not null references account(id),
  asset_id uuid references asset(id),
  type text not null check (type in ('buy', 'sell', 'dividend', 'fee')),
  quantity numeric(20,8) check (quantity > 0),
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null default 'EUR',
  operated_on date not null,
  note text,
  created_at timestamptz not null default now(),
  check (type not in ('buy', 'sell') or (asset_id is not null and quantity is not null))
);
create index investment_operation_account on investment_operation (account_id, operated_on desc);

create table asset_price (
  asset_id uuid not null references asset(id) on delete cascade,
  quoted_on date not null,
  price numeric(18,8) not null check (price >= 0),
  currency char(3) not null default 'EUR',
  primary key (asset_id, quoted_on)
);
