-- A subscription partly paid back by someone else (an employer covering half of
-- a transport pass) states the claim once, on the commitment, instead of on
-- every occurrence by hand. Each confirmed occurrence becomes an ordinary
-- advance carrying this debtor and this share (see 0005): the claim, its
-- refunds and its write-off stay the movement's, never redone here.
--
-- The share is euros, like an advance's, never a percentage: a stored
-- percentage would move the claim silently whenever the price moves. A price
-- change leaves it as stated, and a price below it is refused, for the same
-- reason an advance cannot exceed its expense.

alter table commitment
  add column expected_refund_from_actor_id uuid references actor(id),
  add column expected_refund_amount numeric(12,2),
  add constraint commitment_refund_amount_positive
    check (expected_refund_amount is null or expected_refund_amount > 0),
  add constraint commitment_refund_amount_within_amount
    check (expected_refund_amount is null or expected_refund_amount <= amount),
  add constraint commitment_refund_amount_with_debtor
    check ((expected_refund_amount is null) = (expected_refund_from_actor_id is null)),
  -- Only an expense can be an advance: a revenue is not owed back, and a
  -- financing's installments are a written plan of its own.
  add constraint commitment_refund_on_subscription
    check (expected_refund_amount is null or (kind = 'subscription' and direction = 'outgoing'));
