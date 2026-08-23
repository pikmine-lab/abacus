-- Prices. Two kinds, and they do not belong to the same owner.
--
-- A quoted instrument's price is public data: read once, it serves every user
-- holding that instrument, so it hangs off `instrument` and carries no user.
-- A price typed by hand (unlisted shares, an SCPI, a property) is a declaration
-- like any other, so it stays on the holder's own `asset`.
--
-- Only the latest known price is stored, deliberately: a daily close history
-- would serve a valuation-over-time chart, and there is no such chart yet.
-- `0002` already paid for laying out tables ahead of the code that reads them.
--
-- Two timestamps, because they answer two questions. `quoted_at` is when the
-- market made that price, and it is what the screen shows. `fetched_at` is when
-- we asked, and it is what the freshness bound reads: outside trading hours we
-- may well fetch at 22:00 a price the exchange stamped 17:35, and treating those
-- as one number would either re-fetch a frozen price forever or show a fetch
-- time as if it were a market time.

create table instrument_quote (
  instrument_id uuid primary key references instrument(id) on delete cascade,
  price numeric(18,8) not null check (price >= 0),
  currency char(3) not null,
  quoted_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  -- Whether its venue was trading when we asked. A closed market cannot move,
  -- so this buys a longer freshness bound for the three quarters of the week
  -- Euronext is shut, and lets the screen say the price is a close.
  market_open boolean not null default true
);

alter table asset
  add column manual_price numeric(18,8) check (manual_price >= 0),
  add column manual_priced_on date,
  -- A price with no date could not be read out loud ("worth X, as of when?").
  add constraint asset_manual_price_is_dated
    check ((manual_price is null) = (manual_priced_on is null)),
  -- A listed asset takes its price from the shared instrument; a hand-typed one
  -- next to it would be a second answer to the same question.
  add constraint asset_manual_price_has_no_instrument
    check (manual_price is null or instrument_id is null);
