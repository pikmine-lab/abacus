-- Two readings the grammar of 0018 could not name (issue #82).
--
-- `year` completes the period references. A monthly rule assessed on a yearly
-- figure had `ytd` alone, which grows from the first period of the year to the
-- last: the bracket or the tramo it names moves month after month, while the
-- regime it models reads one and the same year for all of them. `year` is that
-- window, the whole fiscal year of the period, identical for every period it
-- holds; `ytd` keeps its own meaning, the year up to the period read.
--
-- `per_period` completes the base scales. A quarterly instalment assessed on an
-- annual measure had to carry the quarter inside its rate, which mixes the
-- legal rate with an arithmetic of its own and hides both. The scale divides
-- the measure by the number of the rule's periods a fiscal year holds, so the
-- rate stays the rate the text fixes.

alter table levy drop constraint levy_base_period_ref_check;
alter table levy add constraint levy_base_period_ref_check
  check (base_period_ref in ('current', 'ytd', 'year', 'year-1', 'year-2', 'rolling-12'));

alter table levy drop constraint levy_base_scale_check;
alter table levy add constraint levy_base_scale_check
  check (base_scale in ('none', 'per_month', 'per_period', 'annualized'));

alter table threshold drop constraint threshold_period_ref_check;
alter table threshold add constraint threshold_period_ref_check
  check (period_ref in ('current', 'ytd', 'year', 'year-1', 'year-2', 'rolling-12'));
