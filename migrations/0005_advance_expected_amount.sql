-- An advance carried who owes a refund, never how much: the claim was the whole
-- expense. Splitting a bill breaks that, so the expected share becomes written
-- data, and never implicit again: an advance without an amount is an advance
-- without a debtor.

alter table movement
  add column expected_refund_amount numeric(12,2);

-- Existing advances were claims on the full amount. Say so, instead of leaving
-- the reader to infer it from a null.
update movement
set expected_refund_amount = amount
where expected_refund_from_actor_id is not null;

alter table movement
  add constraint movement_advance_amount_positive
    check (expected_refund_amount is null or expected_refund_amount > 0),
  -- You cannot be owed back more than what left the account.
  add constraint movement_advance_amount_within_expense
    check (expected_refund_amount is null or expected_refund_amount <= amount),
  add constraint movement_advance_amount_with_debtor
    check ((expected_refund_amount is null) = (expected_refund_from_actor_id is null));
