-- An activity becomes something to run, not only a sphere to file under
-- (issue #83, part of #82).
--
-- Until now an activity was a name: a movement filed under it belonged to that
-- sphere, and nothing else followed. Running an independent activity asks more
-- of it: a regime (which date brings a receipt into the revenue, whether VAT is
-- charged, whether expenses reduce a profit), a fiscal year, a beginning and an
-- end, and the accounts whose money is the activity's. None of that says which
-- country or which regime: those are the rules of 0018, in data. This schema
-- only holds what every regime needs a place for.
--
-- Two kinds. A `business` activity has rules, invoices and a statement. A
-- `personal` activity keeps exactly what an activity was until now: an analysis
-- dimension, nothing more.
--
-- An activity never changes regime. A regime that ends (a business closed in
-- one country, another opened elsewhere) is a closed activity and a new one,
-- each with its own accounts, currency and fiscal year: the statement of a year
-- reads one, the statement of the next reads the other, and history is never
-- rewritten under a new regime. `closed_on` holds the end; the service refuses
-- to change `kind` or `revenue_basis` once rules or invoices exist.

alter table activity
  add column kind text not null default 'personal'
    check (kind in ('business', 'personal')),
  add column started_on date,
  add column closed_on date,
  -- The day the fiscal year opens (1 January nearly everywhere, 6 April in the
  -- UK). Every "year" a rule speaks of is this year, and every year-to-date
  -- starts here.
  add column fiscal_year_start_month smallint not null default 1
    check (fiscal_year_start_month between 1 and 12),
  add column fiscal_year_start_day smallint not null default 1
    check (fiscal_year_start_day between 1 and 31),
  -- Which date brings a receipt into the revenue and into the bases of the
  -- rules: the day the money arrived (cash) or the day the invoice was issued
  -- (invoiced). A property of the regime, distinct from the app-wide reading of
  -- 0011 and 0015, which is a personal way of counting months and never a
  -- fiscal fact.
  add column revenue_basis text not null default 'cash'
    check (revenue_basis in ('cash', 'invoiced')),
  add column vat_registered boolean not null default false,
  -- The rate proposed on a new invoice or a new expense; a client's own default
  -- (actor.invoice_vat_rate) and the invoice itself may differ.
  add column default_vat_rate numeric(5,2)
    check (default_vat_rate is null or (default_vat_rate >= 0 and default_vat_rate <= 100)),
  -- 'all': every expense of the activity reduces its profit, except the
  -- categories listed in activity_category_exception. 'none': a flat-rate
  -- regime deducts nothing, and the exceptions then list what is deductible
  -- anyway.
  add column deductible_expenses text not null default 'none'
    check (deductible_expenses in ('all', 'none')),
  -- Free words for the screen ("Micro-entreprise BNC", "Estimación directa
  -- simplificada"): a label, never a switch the code reads.
  add column regime_label text,
  add column currency char(3) not null default 'EUR',
  add column updated_at timestamptz not null default now(),
  add constraint activity_closes_after_it_started
    check (closed_on is null or started_on is null or closed_on >= started_on),
  add constraint activity_vat_rate_when_registered
    check (vat_registered or default_vat_rate is null);

-- The categories that go against the activity's deductibility policy: excluded
-- when the policy is 'all', deductible when it is 'none'.
create table activity_category_exception (
  activity_id uuid not null references activity(id) on delete cascade,
  category_id uuid not null references category(id),
  primary key (activity_id, category_id)
);

-- An account owned by the activity. Its balance is the activity's treasury,
-- and a transfer from one of its accounts to an account outside the activity
-- is the owner paying themselves: that is the only definition "what did I pay
-- myself" ever gets. An account with no activity is personal.
alter table account add column activity_id uuid references activity(id);
create index account_activity on account (activity_id) where activity_id is not null;

-- What a client does to an invoice: the VAT it bears and the withholding it
-- keeps back and pays to the tax office in the supplier's name. Both depend on
-- the payer (a domestic business withholds, a foreign one does not; an
-- intra-EU business pays no VAT), so they live on the actor as defaults the
-- invoice copies at creation and may override.
alter table actor
  add column invoice_vat_rate numeric(5,2)
    check (invoice_vat_rate is null or (invoice_vat_rate >= 0 and invoice_vat_rate <= 100)),
  add column invoice_withholding_rate numeric(5,2)
    check (invoice_withholding_rate is null or (invoice_withholding_rate >= 0 and invoice_withholding_rate <= 100));
