-- How the Analyse screen draws its ranking, settled once like the reading (see
-- 0015, whose table was made to take the next preference as a column).
--
-- The same rows read two ways, and neither is wrong: `strip` lays the period
-- out as one bar cut into shares, with the list underneath giving each share;
-- `bars` gives each line its own bar, which compares neighbours more finely.
-- Which one a person reads best is theirs to say, not a screen's to impose.
--
-- A display, nothing more: it changes no figure and no data, and nothing reads
-- it but the screen that draws the ranking.

alter table user_preference
  add column ranking_view text not null default 'strip' check (ranking_view in ('strip', 'bars'));
