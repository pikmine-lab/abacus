-- A scheduled placement: the recurring commitment that buys (issue #59).
--
-- Paying a fixed sum into the market every month is the most common form of
-- stock-market saving, and it was the one recurrence this app could not hold.
-- Each instalment had to be retyped as two unrelated gestures, an internal
-- transfer then a purchase: nothing recalled the due date, nothing noticed a
-- forgotten month, and the sum committed monthly appeared nowhere although it
-- is committed exactly as a subscription is.
--
-- It becomes a third kind of commitment rather than a table of its own: the
-- occurrence engine, the dated amount history and the dated account (0006) are
-- the very same ones, and a separate table would have had to grow all three
-- again, then drift from them.
--
-- What makes it its own kind is that it has no actor. The money goes from one
-- account to another account of the same person, so an occurrence is an
-- internal transfer, neutral by construction, and it carries no category for
-- the same reason no transfer ever does. Both of its endpoints are accounts,
-- which is why the target is a column here where the other kinds have an
-- actor. The source is any account the user owns, not necessarily a bank
-- account: a broker's cash account funding its own securities account is the
-- ordinary case.
--
-- One thing this schema deliberately does not try to hold: confirming an
-- occurrence cannot be the zero-input gesture a subscription's is. The order
-- executes at an intraday price, which no daily close can reproduce, so the
-- quantity bought is declared and never derived from the amount; deriving it
-- would write a false average cost, compounding instalment after instalment.
-- That rule belongs to the service. The schema only makes the asset part of
-- the plan, so an occurrence knows what it buys.

alter table commitment drop constraint commitment_kind_check;
alter table commitment add constraint commitment_kind_check
  check (kind in ('subscription', 'financing', 'investment_plan'));

-- An actor is what a commitment bills or is billed by, and an internal
-- transfer has none: exactly one for the other kinds, never one here.
alter table commitment alter column actor_id drop not null;

alter table commitment
  add column target_account_id uuid,
  -- Frozen to 'investment' so the composite foreign key below enforces in the
  -- database that a plan can only feed an investment account. It also blocks
  -- the reverse: an account receiving a plan can no longer change behavior.
  add column target_account_behavior text
    check (target_account_behavior = 'investment'),
  -- What each occurrence buys. A plan that changed asset would describe
  -- something else, so the service treats it as a correction, not history.
  add column asset_id uuid references asset(id),
  add constraint commitment_actor_unless_internal
    check ((actor_id is null) = (kind = 'investment_plan')),
  -- Without this, a target could be set with a null behavior and slip past the
  -- composite foreign key, which is satisfied as soon as one side is null.
  add constraint commitment_target_carries_its_behavior
    check ((target_account_id is null) = (target_account_behavior is null)),
  -- An account feeding itself is a typo, and would make a movement the model
  -- refuses anyway.
  add constraint commitment_target_is_not_the_source
    check (target_account_id is null or target_account_id <> account_id),
  add constraint commitment_investment_plan_fields
    check (kind <> 'investment_plan' or (target_account_id is not null and asset_id is not null)),
  add constraint commitment_investment_plan_only
    check (kind = 'investment_plan' or (target_account_id is null and asset_id is null)),
  -- The money leaves the source account, so the occurrence is outgoing like a
  -- subscription's; what it produces is a transfer, hence no category. A plan
  -- is open-ended like a subscription, so it has neither a written schedule
  -- nor a total, and it is not judged: it is not a cost to cut.
  add constraint commitment_investment_plan_outgoing
    check (kind <> 'investment_plan' or direction = 'outgoing'),
  add constraint commitment_investment_plan_plain
    check (
      kind <> 'investment_plan'
      or (
        category_id is null
        and judgment is null
        and judgment_note is null
        and engaged_until is null
        and installments_total is null
        and total_amount is null
      )
    ),
  add foreign key (target_account_id, target_account_behavior) references account (id, behavior);

-- Read when an asset is asked to be forgotten: one a plan buys is not
-- unused, even before its first occurrence.
create index commitment_asset on commitment (asset_id) where asset_id is not null;

-- The purchase an occurrence produced, beside the transfer that funded it.
-- Both are written in one transaction, and this is what keeps them one event
-- afterwards: correcting the transfer can reach its purchase, and a reader can
-- say what a given instalment bought. Its absence is what the issue reproached
-- the manual entry for, so it is not left to be inferred from a shared date.
alter table investment_operation
  add column movement_id uuid references movement(id) on delete set null,
  -- One transfer funds one purchase.
  add constraint investment_operation_movement_unique unique (movement_id);
