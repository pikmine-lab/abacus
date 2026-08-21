-- Investments, for real this time. `0002` laid out `asset`, `investment_operation`
-- and `asset_price` in advance, and nothing ever wrote to them: the only query in
-- the repository that touched them was the count that freezes an account's
-- behavior. Laying out tables ahead of their code turned out to cost more than it
-- saved, because the shape was wrong on the one point that mattered.
--
-- What was wrong: `asset` carried a `user_id` and `asset_price` hung off `asset`,
-- so prices were stored per user. Two people holding the same ETF would have
-- fetched it twice, kept two copies of the same number, and seen two different
-- valuations of one security depending on who opened the page last. A quoted
-- price is neither declared nor owned: it is the one piece of public data in this
-- application, and the same exception as prices not being declarative at all.
--
-- Hence the split: `instrument` is the quoted thing, shared by everyone and owned
-- by no one, identified by where its price comes from and its reference over
-- there. `asset` stays per user: the name they give it, and what they hold. An
-- asset without an instrument is one the user prices by hand, and a declared
-- price is a declaration like any other, so it stays private. Prices themselves
-- land in a later migration, with the code that reads them.
--
-- Operations only ever touch the asset side inside the account. Money reaching
-- the account or leaving it is a movement (an internal transfer), because a
-- movement's nature is derived from its endpoints: an operation written as one
-- would count as an expense, while buying a security spends nothing, it changes
-- the form of the money. So the balance of an investment account is its cash
-- (movements plus operations) and its value is that cash plus what the holdings
-- are worth.

drop table asset_price;
drop table investment_operation;
drop table asset;

-- Public data: no user_id, on purpose. Never surfaced as an autocomplete source,
-- either: the list of instruments we hold would tell each user what the others
-- own. Looking one up goes through the price source's own search.
create table instrument (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('security', 'crypto')),
  -- Its identity is where the price comes from and its reference over there:
  -- ('yahoo', 'CW8.PA'), ('coingecko', 'bitcoin').
  price_source text not null check (price_source in ('yahoo', 'coingecko')),
  price_source_ref text not null,
  name text not null,
  symbol text,
  isin text,
  currency char(3) not null default 'EUR',
  created_at timestamptz not null default now(),
  constraint instrument_identity unique (price_source, price_source_ref)
);

create table asset (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  name text not null,
  -- Null when the user prices it by hand (unlisted shares, an SCPI, a property).
  instrument_id uuid references instrument(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index asset_user_name on asset (user_id, lower(name));
-- Two names for one instrument would split a position in half.
create unique index asset_user_instrument on asset (user_id, instrument_id)
  where instrument_id is not null;

-- Lets the composite foreign key below exist.
alter table account add constraint account_id_behavior unique (id, behavior);

create table investment_operation (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  account_id uuid not null,
  -- Frozen to 'investment' so the composite foreign key below can enforce, in
  -- the database, that only an investment account carries operations. It also
  -- blocks the reverse: an account holding operations can no longer change
  -- behavior, which until now only the service layer refused.
  account_behavior text not null default 'investment'
    check (account_behavior = 'investment'),
  asset_id uuid references asset(id),
  type text not null check (type in ('buy', 'sell', 'dividend', 'fee')),
  quantity numeric(20,8) check (quantity > 0),
  -- What actually left or entered the account's cash, order fees included: the
  -- weighted average cost that comes out of it is then the broker's own, which
  -- is the whole point of the explicit-method rule.
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null default 'EUR',
  operated_on date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, account_behavior) references account (id, behavior),
  -- A trade is an asset in a quantity; a dividend is paid by an asset without
  -- moving any; account fees are about neither.
  constraint investment_operation_trade_has_asset_and_quantity
    check (type not in ('buy', 'sell') or (asset_id is not null and quantity is not null)),
  constraint investment_operation_dividend_has_asset
    check (type <> 'dividend' or asset_id is not null),
  constraint investment_operation_quantity_is_a_trade
    check (type in ('buy', 'sell') or quantity is null)
);
create index investment_operation_account on investment_operation (account_id, operated_on desc);
create index investment_operation_user on investment_operation (user_id, operated_on desc);
create index investment_operation_asset on investment_operation (asset_id) where asset_id is not null;
