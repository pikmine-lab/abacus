-- A claim was three columns of the movement it was advanced on: one debtor,
-- one share, one write-off flag. A bill split between several people could
-- not be stated, a refund could not say whose share it paid back, and an
-- instalment purchase made for someone else could only be claimed instalment
-- by instalment, while the person pays back on a rhythm of their own.
--
-- A claim becomes a share: one row per debtor, the same whatever was advanced.
-- Who owes and how much stay written together (see 0005): the share is never
-- a percentage, and never implied. On a commitment it means one of two things:
--
--   * per occurrence: "they pay back this much of every occurrence" (an
--     employer covering part of a transport pass, see 0029, whose columns
--     move here). It is a rule, not a claim: each confirmed occurrence gets a
--     share of its own on its movement, and refunds go there. Always the case
--     on a subscription, which has no total to owe. In the billing currency,
--     like the price it is part of;
--   * on the total, a financing only: "they owe this much of the whole", paid
--     back on a rhythm of their own, in euros.
--
-- Some rules span several rows or tables, so the service enforces them and no
-- constraint here can: the shares of one object never add up to more than
-- what it costs (the expense, one occurrence, the financing's total), a share
-- is only ever taken on an expense or an outgoing commitment, and a refund
-- never points at a per-occurrence rule.

create table advance_share (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  -- What was advanced: one expense, or a commitment. A movement deleted
  -- without refunds takes its shares with it; one with refunds is refused
  -- before reaching here, since its refunds point at them.
  movement_id uuid references movement(id) on delete cascade,
  commitment_id uuid references commitment(id) on delete cascade,
  per_occurrence boolean not null default false,
  debtor_actor_id uuid not null references actor(id),
  amount numeric(12,2) not null check (amount > 0),
  -- Written off: the rest will never come back. The share stays, and so does
  -- what was refunded on it.
  closed boolean not null default false,
  -- The clock, not the transaction start: the shares of one bill are stated in
  -- one go, and read back in the order they were stated.
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  constraint advance_share_one_object check (num_nonnulls(movement_id, commitment_id) = 1),
  -- A rule for every occurrence only exists on something that recurs, and
  -- there is nothing to write off on a rule.
  constraint advance_share_occurrence_on_commitment
    check (not per_occurrence or (commitment_id is not null and not closed)),
  -- Two shares of the same person on the same object are one share: what they
  -- owe is their sum, and a refund would not know which one it pays back.
  constraint advance_share_one_per_debtor_on_movement unique (movement_id, debtor_actor_id),
  constraint advance_share_one_per_debtor_on_commitment unique (commitment_id, debtor_actor_id)
);
create index advance_share_user on advance_share (user_id);

-- When a share is expected back, when the debtor said: optional, and written
-- down line by line like a financing's plan (0003), because a real promise is
-- rarely N equal amounts. Refunds are never matched to a line: they are
-- compared with the plan in total, which is what makes a share late or not.
create table advance_share_installment (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references advance_share(id) on delete cascade,
  position int not null check (position > 0),
  due_on date not null,
  amount numeric(12,2) not null check (amount > 0),
  constraint advance_share_installment_position_unique unique (share_id, position)
);

-- A refund pays back a share, no longer a movement: with several debtors, the
-- expense alone does not say whose share came back.
alter table movement add column refunds_share_id uuid references advance_share(id);

insert into advance_share (user_id, movement_id, debtor_actor_id, amount, closed)
select user_id, id, expected_refund_from_actor_id, expected_refund_amount, refund_closed
from movement
where expected_refund_from_actor_id is not null;

update movement r
set refunds_share_id = s.id
from advance_share s
where s.movement_id = r.refunds_movement_id;

insert into advance_share (user_id, commitment_id, per_occurrence, debtor_actor_id, amount)
select user_id, id, true, expected_refund_from_actor_id, expected_refund_amount
from commitment
where expected_refund_from_actor_id is not null;

alter table commitment
  drop constraint commitment_refund_amount_positive,
  drop constraint commitment_refund_amount_within_amount,
  drop constraint commitment_refund_amount_with_debtor,
  drop constraint commitment_refund_on_subscription,
  drop column expected_refund_from_actor_id,
  drop column expected_refund_amount;

alter table movement
  drop constraint movement_advance_is_expense,
  drop constraint movement_refund_is_income,
  drop constraint movement_refund_closed_requires_advance,
  drop constraint movement_advance_amount_positive,
  drop constraint movement_advance_amount_within_expense,
  drop constraint movement_advance_amount_with_debtor,
  drop constraint movement_refund_has_no_card;
drop index movement_refunds;
alter table movement
  drop column expected_refund_from_actor_id,
  drop column expected_refund_amount,
  drop column refund_closed,
  drop column refunds_movement_id;

alter table movement
  -- A refund is money coming back from someone into an account.
  add constraint movement_refund_is_income
    check (refunds_share_id is null or (source_actor_id is not null and target_account_id is not null)),
  -- The person who owed it pays the account back, never the card that paid.
  add constraint movement_refund_has_no_card
    check (card_id is null or refunds_share_id is null);
create index movement_refunds on movement (refunds_share_id) where refunds_share_id is not null;

-- What came back on each expense, the one figure every reading deducts from it
-- (a net only deducts money that has moved: AGENTS.md). `refunded` counts every
-- refund, `counted` leaves out the ghost ones, which no analysis reads.
--
-- On an expense of its own, that is the refunds of its shares (an occurrence
-- of a commitment shared per occurrence is one of them). On a financing
-- claimed on its total, the refunds of those shares are spread over the
-- instalments already paid, in their order, each up to the part of it that
-- is claimed (its amount times the claim over the financing's total): an
-- instalment reads net of what came back for it, the way an advanced expense
-- does. Refunds beyond what the paid instalments claim wait for the next one.
--
-- Computed movement by movement, from the movement the query reads: a reading
-- of one person's month joins this view row by row on the movement's key and
-- never computes anyone else's claims. Only a movement something came back on
-- has a row.
create view expense_refund as
select m.id as movement_id,
       (coalesce(own.refunded, 0) + coalesce(spread.refunded, 0))::numeric(14,2) as refunded,
       (coalesce(own.counted, 0) + coalesce(spread.counted, 0))::numeric(14,2) as counted,
       own.last_refunded_on
from movement m
left join lateral (
  select sum(r.amount) as refunded,
         coalesce(sum(r.amount) filter (where not r.ghost), 0) as counted,
         max(r.happened_on) as last_refunded_on
  from advance_share s
  join movement r on r.refunds_share_id = s.id
  where s.movement_id = m.id
  having count(*) > 0
) own on true
left join lateral (
  -- The instalment this movement settled, what its financing's claims on the
  -- total take of it, and what they took of the instalments paid before it.
  select round(least(part.claimed_on_it, greatest(back.refunded - part.claimed_before, 0)), 2) as refunded,
         round(least(part.claimed_on_it, greatest(back.counted - part.claimed_before, 0)), 2) as counted
  from financing_installment fi
  join commitment c on c.id = fi.commitment_id
  cross join lateral (
    select sum(amount) as claimed
    from advance_share
    where commitment_id = fi.commitment_id and not per_occurrence
  ) claim
  cross join lateral (
    select coalesce(sum(r.amount), 0) as refunded,
           coalesce(sum(r.amount) filter (where not r.ghost), 0) as counted
    from advance_share s
    join movement r on r.refunds_share_id = s.id
    where s.commitment_id = fi.commitment_id and not s.per_occurrence
  ) back
  cross join lateral (
    select m.amount * claim.claimed / c.total_amount as claimed_on_it,
           coalesce((
             select sum(pm.amount) * claim.claimed / c.total_amount
             from financing_installment prior
             join movement pm on pm.id = prior.movement_id
             where prior.commitment_id = fi.commitment_id and prior.position < fi.position
           ), 0) as claimed_before
  ) part
  where fi.movement_id = m.id and claim.claimed is not null
) spread on true
where own.refunded is not null or spread.refunded is not null;
