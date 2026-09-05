-- Where an activity is run, and where a regime model is not (issue #90, part of #82).
--
-- The jurisdiction is the first thing someone knows about their own activity,
-- and the last thing a calculation may read. It is words for the screen, like
-- `regime_label` beside it: what a rule computes comes from the rule's own row,
-- never from a country. A calculation branching on this column would put back
-- into the code exactly what 0018 took out of it.
--
-- What is deliberately absent here is any table for the regime models the
-- questionnaire leads to. A model is public reference data shipped with the
-- repository, and applying one copies it: the activity gets rules of its own,
-- owned and correctable, with no living link to the model they came from, so
-- that correcting the catalog later touches no activity already created.
-- Nothing therefore ever joins a user's row to a catalog row, there is no
-- referential integrity to hold and no ownership column to add; the catalog
-- stays where changing a rate is a diff a reviewer reads, in the versioned data
-- files of packages/core/src/regimes, whose shape domain/regime.ts validates on
-- load.

alter table activity add column jurisdiction text;
