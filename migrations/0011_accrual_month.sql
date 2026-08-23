-- The month a movement is about, next to the day it was settled (issue #44).
--
-- The app keeps a cash ledger: a movement counts on the day the money moves.
-- That is the right reading for balances, and a wrong one for monthly analysis
-- as soon as a salary lands on the 2nd or a rent is paid the month before the
-- one it covers. Both months then read false, the first short of an entry and
-- the second carrying two.
--
-- Two rules hold this in place:
--   * the month is stored nullable and resolved on read, never materialised at
--     write time. That is what makes an unattached movement follow its date
--     when the date is corrected, while an explicit attachment survives the
--     same correction;
--   * no balance ever reads it. Balances, balance checks and gap settlements
--     stay sums over happened_on. The check is the only guard rail of a
--     declarative ledger, and one that reasoned by attachment would report
--     gaps that mean nothing and miss a forgotten entry.

alter table movement
  add column accrual_month date,
  -- A month and nothing finer, so the column is that month's first day.
  add constraint movement_accrual_is_a_month
    check (accrual_month is null or accrual_month = date_trunc('month', accrual_month::timestamp)::date),
  -- An internal transfer enters no period total, so there is no month for it
  -- to be about (the same reason it carries no category).
  add constraint movement_transfer_has_no_accrual
    check (accrual_month is null or source_account_id is null or target_account_id is null);

-- The resolved reading, so no analysis ever has an empty case to handle: the
-- declared month when there is one, the settlement day's month otherwise.
-- The cast to timestamp is what makes the expression immutable, and therefore
-- storable: date_trunc over a bare date resolves to the timestamptz overload,
-- which depends on the session timezone.
alter table movement
  add column counted_in_month date generated always as (
    coalesce(accrual_month, date_trunc('month', happened_on::timestamp)::date)
  ) stored;

create index movement_user_counted on movement (user_id, counted_in_month);
