-- A financing is a finite plan, and a real plan is rarely N equal installments
-- on the same day: a first month prorated, a rounding cent on the last one, a
-- date pushed by a weekend. Deriving the occurrences from one amount and one
-- period could not express any of that, so the schedule becomes explicit data.
--
-- Only financings get one. A subscription is open-ended: it has no last
-- installment to write down, and its occurrences stay derived.

create table financing_installment (
  id uuid primary key default gen_random_uuid(),
  commitment_id uuid not null references commitment(id) on delete cascade,
  -- Contractual order, 1..installments_total. The plan is read in this order,
  -- never by date, so two installments may share a date without ambiguity.
  position int not null check (position > 0),
  due_on date not null,
  amount numeric(12,2) not null check (amount > 0),
  -- The movement that settled it, once confirmed. Null while pending.
  movement_id uuid references movement(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financing_installment_position_unique unique (commitment_id, position),
  -- One movement settles at most one installment.
  constraint financing_installment_movement_unique unique (movement_id)
);

create index financing_installment_pending
  on financing_installment (commitment_id, due_on)
  where movement_id is null;

-- Existing financings keep working: their schedule is reconstructed from what
-- they already carried. next_due_on has advanced once per confirmed movement,
-- so the first due date is walked back by that many periods, and the movements
-- already recorded are attached in chronological order.
insert into financing_installment (commitment_id, position, due_on, amount, movement_id)
select
  c.id,
  p.position,
  (
    c.next_due_on
    - make_interval(
        weeks => case when c.period_unit = 'week' then c.period_count * paid.count else 0 end,
        months => case when c.period_unit = 'month' then c.period_count * paid.count else 0 end,
        years => case when c.period_unit = 'year' then c.period_count * paid.count else 0 end
      )
    + make_interval(
        weeks => case when c.period_unit = 'week' then c.period_count * (p.position - 1) else 0 end,
        months => case when c.period_unit = 'month' then c.period_count * (p.position - 1) else 0 end,
        years => case when c.period_unit = 'year' then c.period_count * (p.position - 1) else 0 end
      )
  )::date,
  c.amount,
  settled.movement_id
from commitment c
cross join lateral (
  select count(*)::int as count from movement m where m.commitment_id = c.id
) paid
cross join lateral (
  select generate_series(1, c.installments_total) as position
) p
left join lateral (
  -- The nth movement of this financing settles its nth installment.
  select m.id as movement_id
  from movement m
  where m.commitment_id = c.id
  order by m.happened_on, m.created_at
  offset p.position - 1
  limit 1
) settled on true
where c.kind = 'financing' and c.installments_total is not null;
