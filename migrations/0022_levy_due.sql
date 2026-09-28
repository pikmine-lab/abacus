-- The due date a levy payment settles, next to the payment.
--
-- A due date of the schedule is computed, never stored, so a payment cannot
-- point to a row the way an income points to its invoice. Four values name it
-- instead: the rule, the kind of entry (a period, or the settlement of a closed
-- year), the first day of the period, and the instalment. The first day alone
-- is not enough: a monthly rule settled each year opens its first period and
-- its year's settlement on the same day, and a period paid in instalments has
-- several due dates.
--
-- A payment that names its due date answers that one and no other, whatever
-- day the money left. Matching by date alone would read a payment made early in
-- one window as the late settlement of the window before, and leave the period
-- really paid proposed for payment a second time. A settlement declared without
-- naming one is still matched by its date.
--
-- The link is read only on an expense of the activity filed in the rule's
-- settlement category, which is what a settlement is: a correction that makes
-- the movement something else leaves the link inert rather than refused. No
-- reserve reads it either: what a rule has been paid stays the sum of its
-- settlements, named or not.

alter table movement
  add column levy_id uuid references levy(id),
  add column levy_entry text check (levy_entry in ('period', 'regularization')),
  add column levy_period_start date,
  add column levy_instalment smallint check (levy_instalment > 0),
  -- A due date is named whole or not at all.
  add constraint movement_levy_due_whole
    check (num_nonnulls(levy_id, levy_entry, levy_period_start, levy_instalment) in (0, 4));
create index movement_levy on movement (levy_id) where levy_id is not null;
