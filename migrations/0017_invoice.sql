-- An invoice: issued, awaited, then paid (issue #84, part of #82).
--
-- A movement says what the bank saw. An invoice says what was asked of a client
-- and when, which the bank never sees until the money arrives, and sometimes
-- never entirely: a client that withholds tax pays the net and the tax office
-- the rest. Three facts live only here: the revenue as invoiced (the fact that
-- several regimes tax), the VAT collected, and the withholding, which is tax
-- already paid and a credit on the income tax.
--
-- Amounts are stated, not derived from a rate: a rate proposes, the invoice
-- says what was written on it, rounding included. `total_amount` is what the
-- client owes, `receivable_amount` what reaches the account: base + VAT −
-- withholding.
--
-- The state is never stored. Paid is "the linked incomes reach the
-- receivable", overdue is "not paid and past due_on", cancelled is
-- `cancelled_on`. A stored flag would lie the day a payment is corrected.
--
-- abacus records invoices, it does not issue them: legal numbering, signatures
-- and certified transmission belong to the invoicing tool, and nothing here
-- pretends otherwise.

create table invoice (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  activity_id uuid not null references activity(id),
  -- The client.
  actor_id uuid not null references actor(id),
  reference text,
  issued_on date not null,
  due_on date,
  currency char(3) not null default 'EUR',
  base_amount numeric(12,2) not null check (base_amount > 0),
  vat_rate numeric(5,2) not null default 0 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount numeric(12,2) not null default 0 check (vat_amount >= 0),
  withholding_rate numeric(5,2) not null default 0
    check (withholding_rate >= 0 and withholding_rate <= 100),
  withholding_amount numeric(12,2) not null default 0 check (withholding_amount >= 0),
  total_amount numeric(12,2) not null generated always as (base_amount + vat_amount) stored,
  receivable_amount numeric(12,2) not null
    generated always as (base_amount + vat_amount - withholding_amount) stored,
  note text,
  -- The last time the client was reminded; the screen says how long ago.
  reminded_on date,
  cancelled_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_due_after_issue check (due_on is null or due_on >= issued_on),
  constraint invoice_withholding_within_total check (withholding_amount <= base_amount + vat_amount)
);
create index invoice_activity_issued on invoice (activity_id, issued_on desc);
create index invoice_actor on invoice (actor_id);
-- A reference identifies an invoice within its activity: two activities may
-- reuse a numbering, two invoices of one activity may not.
create unique index invoice_activity_reference
  on invoice (activity_id, lower(reference)) where reference is not null;

-- An income can pay an invoice, and several incomes can pay one (partial
-- payments). Paying is a link, never a copy: the invoice keeps saying what was
-- asked, the movement what arrived.
alter table movement
  add column invoice_id uuid references invoice(id),
  -- The VAT inside this movement: deductible on an expense of a registered
  -- activity, collected on an income that pays no invoice. Null means "none
  -- stated", which for an unregistered activity is the truth.
  add column vat_amount numeric(12,2) check (vat_amount is null or vat_amount >= 0),
  -- Only an income pays an invoice.
  add constraint movement_invoice_is_income
    check (invoice_id is null or (source_actor_id is not null and target_account_id is not null)),
  add constraint movement_vat_within_amount
    check (vat_amount is null or vat_amount <= amount),
  -- An internal transfer carries no VAT, as it carries no category.
  add constraint movement_transfer_has_no_vat
    check (source_account_id is null or target_account_id is null or vat_amount is null);
create index movement_invoice on movement (invoice_id) where invoice_id is not null;
