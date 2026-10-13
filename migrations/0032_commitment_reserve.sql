-- Money received for a commitment (someone covers the next months of a
-- subscription, or part of an instalment purchase) is not a claim: nobody owes
-- it, it has already landed on the account. It is a reserve, fed by the
-- incomes linked to the commitment, that its occurrences draw from until it is
-- empty.
--
-- Each confirmed occurrence draws what is left of it once its own refunds are
-- deducted (a share per occurrence, a financing's claims on its total): the
-- reserve comes after everything. An occurrence whose 50% refund has not come
-- back yet draws its whole amount, and only the other half once it has, the
-- difference going back to the reserve. That is why the draw is computed and
-- never stored: it moves with the refunds.
--
-- An occurrence of a subscription only draws from money that had arrived on
-- its day: a top-up after a gap does not cover the months that went without.
-- A financing draws from its whole reserve, whenever the money came, since it
-- is one purchase paid in parts.
--
-- What is not drawn is neither an income nor deducted from anything while the
-- commitment runs: it sits on the account, already bound to leave. Once the
-- commitment is over (cancelled, or a financing paid off), what is left becomes
-- an income of that day: it is free again. It is carried by the incomes that
-- fed the reserve, the latest ones first, since the oldest money is drawn
-- first: the analysis keeps leading to real movements.

alter table movement
  add column reserves_commitment_id uuid references commitment(id),
  -- Money coming in from someone, to an account: never to a card, and never
  -- also the refund of a share, which would count it twice.
  add constraint movement_reserve_is_income
    check (reserves_commitment_id is null or (source_actor_id is not null and target_account_id is not null)),
  add constraint movement_reserve_has_no_card
    check (reserves_commitment_id is null or card_id is null),
  add constraint movement_reserve_or_refund
    check (reserves_commitment_id is null or refunds_share_id is null);
create index movement_reserves on movement (reserves_commitment_id) where reserves_commitment_id is not null;

-- What came back on each expense through its shares: the view 0030 named
-- expense_refund, whose name now goes to the sum of both.
alter view expense_refund rename to share_refund;

-- What each occurrence of a commitment with a reserve draws from it. The
-- reserve is drawn in the order the occurrences were paid (a financing's
-- instalments in the order of its plan), each up to what is left of it, until
-- the money available is gone. With D the draws so far, R the running sum of
-- what the occurrences leave and I the money available on each one's day,
-- D(i) = min(D(i-1) + left(i), I(i)), which unrolls into
-- D(i) = R(i) + min(0, min over k <= i of (I(k) - R(k))): one window, no
-- recursion. `counted` does the same without the ghost movements, which no
-- analysis reads, on either side.
create view reserve_draw as
with occurrence as (
  select m.id, m.commitment_id,
         coalesce(fi.position, 0) as position,
         coalesce(m.purchased_on, m.happened_on) as paid_on,
         m.created_at,
         greatest(m.amount - coalesce(sr.refunded, 0), 0) as left_all,
         -- A ghost occurrence is read by no analysis: it draws nothing of
         -- what the analyses count, which stays for the occurrences they read.
         case when m.ghost then 0 else greatest(m.amount - coalesce(sr.counted, 0), 0) end as left_counted,
         (select coalesce(sum(r.amount), 0) from movement r
          where r.reserves_commitment_id = m.commitment_id
            and (c.kind = 'financing' or r.happened_on <= coalesce(m.purchased_on, m.happened_on))) as available_all,
         (select coalesce(sum(r.amount), 0) from movement r
          where r.reserves_commitment_id = m.commitment_id and not r.ghost
            and (c.kind = 'financing' or r.happened_on <= coalesce(m.purchased_on, m.happened_on))) as available_counted
  from movement m
  join commitment c on c.id = m.commitment_id
  left join financing_installment fi on fi.movement_id = m.id
  left join share_refund sr on sr.movement_id = m.id
  where m.kind = 'expense'
    and exists (select 1 from movement r where r.reserves_commitment_id = m.commitment_id)
),
running as (
  select o.*,
         sum(left_all) over w as r_all,
         sum(left_counted) over w as r_counted
  from occurrence o
  window w as (partition by commitment_id order by position, paid_on, created_at, id)
),
capped as (
  select r.*,
         r_all + least(0, min(available_all - r_all) over w) as d_all,
         r_counted + least(0, min(available_counted - r_counted) over w) as d_counted
  from running r
  window w as (partition by commitment_id order by position, paid_on, created_at, id)
)
select id as movement_id, commitment_id,
       (d_all - coalesce(lag(d_all) over w, 0))::numeric(14,2) as drawn,
       (d_counted - coalesce(lag(d_counted) over w, 0))::numeric(14,2) as counted
from capped
window w as (partition by commitment_id order by position, paid_on, created_at, id);

-- What came back on each expense, the one figure every reading deducts from it
-- (a net only deducts money that has moved: AGENTS.md): the refunds of its
-- shares, plus what it drew from its commitment's reserve. `refunded` counts
-- everything, `counted` leaves out the ghosts; `share_refunded` and `drawn`
-- keep the two apart for the screens that say which is which.
--
-- Built from the movement, like share_refund, so that a reading joining it on
-- the movement's key computes that movement only: the draws are looked up by
-- its commitment, which the window partitions on, so only that commitment's
-- occurrences are drawn. `offset 0` keeps the lookup a subquery the
-- commitment can be pushed into, instead of a join over every reserve.
create view expense_refund as
select m.id as movement_id,
       (coalesce(sr.refunded, 0) + coalesce(rd.drawn, 0))::numeric(14,2) as refunded,
       (coalesce(sr.counted, 0) + coalesce(rd.counted, 0))::numeric(14,2) as counted,
       sr.last_refunded_on,
       sr.refunded as share_refunded,
       rd.drawn
from movement m
left join share_refund sr on sr.movement_id = m.id
left join lateral (
  select d.drawn, d.counted from reserve_draw d
  where d.commitment_id = m.commitment_id and d.movement_id = m.id and (d.drawn > 0 or d.counted > 0)
  offset 0
) rd on m.commitment_id is not null
where sr.movement_id is not null or rd.drawn is not null;

-- A reserve per commitment: what fed it, what its occurrences drew, and, once
-- the commitment is over, the day what is left became free. `counted_left` is
-- the same remainder without the ghosts, the part a release may count. A commitment is
-- over on the day it was cancelled, a financing closed before its end
-- included; a financing also on the day its last instalment was paid, derived
-- as the commitment reads do. A cancellation dated ahead releases nothing yet:
-- the occurrences until then still draw.
create view commitment_reserve as
select c.id as commitment_id,
       fed.received,
       coalesce(d.drawn, 0)::numeric(14,2) as drawn,
       (fed.received - coalesce(d.drawn, 0))::numeric(14,2) as remaining,
       case when ended.ended_on <= current_date then ended.ended_on end as released_on,
       (fed.counted - coalesce(d.counted, 0))::numeric(14,2) as counted_left
from commitment c
join lateral (
  select sum(r.amount)::numeric(14,2) as received,
         coalesce(sum(r.amount) filter (where not r.ghost), 0) as counted
  from movement r where r.reserves_commitment_id = c.id
  having count(*) > 0
) fed on true
left join lateral (
  select sum(drawn) as drawn, sum(counted) as counted from reserve_draw where commitment_id = c.id
) d on true
left join lateral (
  select max(i.due_on) as settled_on from financing_installment i
  where i.commitment_id = c.id
  having bool_and(i.movement_id is not null)
) settled on true
cross join lateral (
  select coalesce(c.cancelled_on, case when c.kind = 'financing' then settled.settled_on end) as ended_on
) ended;

-- What each income of a reserve gives back once its commitment is over: the
-- part of it nothing drew. The oldest money is drawn first, so what is left
-- belongs to the latest incomes, each up to its own amount. A ghost is read by
-- no analysis, so the release is spread over the other incomes only, out of
-- what the analyses did not draw: a ghost income is never counted twice.
create view reserve_release as
select r.id as movement_id, cr.released_on,
       greatest(least(r.amount, cr.counted_left - (
         select coalesce(sum(later.amount), 0) from movement later
         where later.reserves_commitment_id = r.reserves_commitment_id and not later.ghost
           and (later.happened_on, later.created_at, later.id) > (r.happened_on, r.created_at, r.id)
       )), 0)::numeric(14,2) as released
from movement r
join commitment_reserve cr on cr.commitment_id = r.reserves_commitment_id
where not r.ghost and cr.released_on is not null and cr.counted_left > 0;
