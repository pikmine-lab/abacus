-- A movement that touched the account and says nothing about the flows (issue #53).
--
-- An exceptional movement (an insurance payout, a gift received, money coming
-- from an account that is not tracked, a regularisation) wrecks the comparison
-- of one month against the next: the month it lands in becomes unreadable, and
-- every other month is then read against it. Nothing else in the model says
-- "this did hit the account, but it says nothing about my flows".
--
-- The model already holds that neutrality once: an internal transfer counts in
-- the balances and in no period total. A ghost extends it to a movement that
-- has an external counterparty, and therefore a nature (expense or income).
--
-- Two rules hold this in place:
--   * no balance ever reads it, exactly as none reads the accrual month
--     (0011). Balances, balance checks and gap settlements stay raw sums over
--     happened_on. The check is the only guard rail of a declarative ledger:
--     one that skipped ghosts would stop catching a forgotten entry;
--   * an internal transfer is never a ghost. It enters no period total to
--     begin with, so the flag would promise something it does not do (the same
--     reason it carries neither a category nor an accrual month).

alter table movement
  add column ghost boolean not null default false,
  add constraint movement_transfer_is_never_ghost
    check (ghost = false or source_account_id is null or target_account_id is null);
