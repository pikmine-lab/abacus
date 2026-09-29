-- A financing paid by card (issue #107). A pay-in-N is usually charged to a
-- card, installment by installment: on a deferred-debit card each one leaves
-- the account with its statement, not on its due date. The schedule still says
-- what is owed and when; the card says what pays it and when the account is
-- debited, so the two combine the way they do for a subscription.
--
-- A card pays for something, so it only goes on an expense: an outgoing
-- subscription or a financing (always outgoing). A revenue is not paid by card
-- and a placement is a transfer between two accounts.
alter table commitment
  drop constraint commitment_card_on_subscription,
  add constraint commitment_card_on_expense
    check (card_id is null or (kind in ('subscription', 'financing') and direction = 'outgoing'));
