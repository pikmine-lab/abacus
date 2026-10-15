-- What covers a financing's installments, read where every net already reads
-- it: the claims on its total spread over its paid installments
-- (`share_refund`) and what its reserve drew from them (`reserve_draw`). The
-- figure a screen or the MCP shows of it is the sum of what the analyses
-- deduct for those two, never a second computation from the totals that could
-- drift from it. Shares per instalment are not part of it: each row names its
-- own refunds.

-- `share_refund` adds the refunds of an expense's own shares to what the
-- claims on its financing's total cover of it. `on_total` keeps the second
-- apart: a financing says who covered its installments, the claims on its
-- total apart from its reserve. Same body as 0030, one column more.
create or replace view share_refund as
select m.id as movement_id,
       (coalesce(own.refunded, 0) + coalesce(spread.refunded, 0))::numeric(14,2) as refunded,
       (coalesce(own.counted, 0) + coalesce(spread.counted, 0))::numeric(14,2) as counted,
       own.last_refunded_on,
       spread.refunded::numeric(14,2) as on_total
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

-- What covers each financing that someone claimed on its total or gave money
-- for, all money that has moved, ghosts included, as a share's `refunded`.
--
-- `covered` is what the paid installments read net of: the claims' part of
-- each, plus what each drew from the reserve. `ahead` is money already there
-- that covers nothing yet: refunds beyond what the paid installments claim,
-- and what the reserve still holds, until it is released and becomes an
-- income. `refunds_covered` and `refunds_ahead` are the claims' part of both,
-- null when nobody owes anything of the total.
create view financing_coverage as
select c.id as commitment_id,
       claims.covered as refunds_covered,
       -- Each instalment's part is rounded on its own, so their sum can pass
       -- what came back by a cent: nothing is ahead then, never less.
       -- `greatest` skips nulls, hence the case: no claim stays null.
       case when claims.covered is not null
            then greatest(claims.back - claims.covered, 0) end::numeric(14,2) as refunds_ahead,
       (coalesce(claims.covered, 0) + coalesce(cr.drawn, 0))::numeric(14,2) as covered,
       (coalesce(greatest(claims.back - claims.covered, 0), 0)
         + case when cr.released_on is null then coalesce(cr.remaining, 0) else 0 end)::numeric(14,2) as ahead
from commitment c
left join lateral (
  select coalesce((
           select sum(sr.on_total) from financing_installment fi
           join share_refund sr on sr.movement_id = fi.movement_id
           where fi.commitment_id = c.id
         ), 0)::numeric(14,2) as covered,
         coalesce(sum(r.amount), 0) as back
  from advance_share s
  left join movement r on r.refunds_share_id = s.id
  where s.commitment_id = c.id and not s.per_occurrence
  having count(s.id) > 0
) claims on true
left join commitment_reserve cr on cr.commitment_id = c.id
where c.kind = 'financing' and (claims.covered is not null or cr.commitment_id is not null);
