-- A daily close per instrument, so a valuation can be drawn over time.
--
-- `0008` deliberately kept only the latest price, on the grounds that no screen
-- read a history. One does now: the point of a portfolio is the curve, and a
-- single number cannot show whether it is going anywhere. The sources hand this
-- over cheaply (one call brings a year of daily closes, 256 points in 27 KB),
-- so the table is filled by backfill when an instrument first appears, and kept
-- up by the same refresh that reads the spot price.
--
-- Public data again, like the instrument it hangs off: read once, valid for
-- everyone holding it. What each user held on a given day comes from their own
-- operations, which are dated, so the two multiply into a personal curve out of
-- one shared history.

create table instrument_price (
  instrument_id uuid not null references instrument(id) on delete cascade,
  quoted_on date not null,
  price numeric(18,8) not null check (price >= 0),
  primary key (instrument_id, quoted_on)
);

-- A hand-priced asset gets its own history, private like its price: revaluing
-- an SCPI once a year is a declaration, and a curve of two points is still a
-- curve.
create table asset_price (
  asset_id uuid not null references asset(id) on delete cascade,
  quoted_on date not null,
  price numeric(18,8) not null check (price >= 0),
  primary key (asset_id, quoted_on)
);
