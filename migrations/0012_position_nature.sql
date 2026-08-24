-- The nature of what is held: shares, funds, crypto (issue #57).
--
-- An account presents everything it holds in one list, so the first thing one
-- asks of it, how much sits in shares against funds against crypto, has to be
-- reconstituted by recognising each line by its name and adding up. That split
-- is the allocation decision, the one that gets revised, so it is a stored
-- fact and not a rendering.
--
-- It lands in `kind` rather than beside it: a second column would make a coin
-- both `kind = 'crypto'` and `nature = 'crypto'`, two spellings of one fact,
-- and the stale one is the one that would get believed. `security` therefore
-- keeps its row and narrows its meaning: quoted, nature not known yet. Nothing
-- has to correct that by hand, because the price call itself carries the answer
-- (`meta.instrumentType` on Yahoo's chart endpoint) and every read of a page
-- refreshes prices: an instrument classifies itself, the ones already stored
-- included.

alter table instrument drop constraint instrument_kind_check;
alter table instrument add constraint instrument_kind_check
  check (kind in ('security', 'equity', 'fund', 'crypto', 'currency'));

-- What no source quotes has no source to ask, so its nature is declared along
-- with it: an SCPI, a property, unlisted shares. An exchange pair is missing on
-- purpose, being the one instrument nobody ever holds.
alter table asset
  add column nature text
    check (nature in ('equity', 'fund', 'crypto', 'bond', 'real_estate', 'other'));
-- Nothing was ever asked of the assets declared before this column: they are
-- unclassified, which is exactly what "other" says.
update asset set nature = 'other' where instrument_id is null;
-- Set exactly when no instrument answers for it, so the nature of a holding is
-- only ever read on one side, and neither side can contradict the other.
alter table asset add constraint asset_nature_replaces_instrument
  check ((instrument_id is null) = (nature is not null));
