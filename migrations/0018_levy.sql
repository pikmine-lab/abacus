-- The rules of a regime, in data (issue #85, part of #82).
--
-- A levy is one thing the activity owes: a social contribution, an income tax
-- or its instalments, a VAT return, a local tax. No rate, no country, no regime
-- is written in the code: a regime is the set of levy rows of an activity, each
-- saying its base, how the base becomes an amount, when it is due, whether it
-- is regularised later, what reduces it for a time, and which category settles
-- it. The grammar those rows speak is the code's; six regimes studied at their
-- primary sources (FR micro, ES common and foral, UK, DE, PT, IT) fit in it,
-- and public rules-as-code references (publicodes, OpenFisca, PolicyEngine,
-- GETTSIM) date their parameters the same way.
--
-- A rule is worth its source. Each row carries the URL of the text, the day it
-- was checked, the day it should be checked again (a yearly schedule ages every
-- 1 January), and a status: confirmed, extended by default when a text lapsed
-- and the administration keeps applying it, unconfirmed when no text fixes the
-- value. The screen shows the status; a figure is never quieter than its
-- source.
--
-- A rate that changes is a new row with a new `valid_from`, never an update:
-- what last year's statement was computed with stays readable.
--
-- Structured parameters (bracket tables, credit lists, due windows) are JSON.
-- Their shape is owned by packages/core/src/domain/levy.ts, the one place both
-- interfaces validate them; SQL holds what it can check with a constraint and
-- lets the rest be a document, because a bracket table is one value, not eight
-- columns.

create table levy (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  activity_id uuid not null references activity(id),
  name text not null,
  kind text not null check (kind in ('social', 'income_tax', 'vat', 'other')),
  valid_from date not null,
  valid_to date,
  source_url text,
  verified_on date,
  review_on date,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'extended_by_default', 'unconfirmed')),

  -- Base: a measure over a period reference, then transformations in a fixed
  -- order (coefficient, add-back, abatement, floor and cap, credits, scale).
  base_measure text not null
    check (base_measure in ('revenue', 'revenue_incl_vat', 'expenses', 'profit', 'vat_balance',
                            'withholdings', 'paid', 'amount', 'input', 'none')),
  -- For `paid` and `amount`: the levy whose settlements or computed amount is
  -- the base.
  base_levy_id uuid references levy(id),
  -- For `input`: the name of the dated figure the user stated.
  base_input_name text,
  base_period_ref text not null default 'current'
    check (base_period_ref in ('current', 'ytd', 'year-1', 'year-2', 'rolling-12')),
  base_coefficient numeric(8,4),
  -- {"rate": 34, "minAmount": 305} or {"brackets": [{"upTo": 35000, "rate": 20},
  -- {"upTo": 85000, "rate": 15}, {"upTo": null, "rate": 10}], "on": {"measure":
  -- "profit", "periodRef": "year-1"}}.
  base_abatement jsonb,
  -- Levies whose settlements are added back before the abatement.
  base_add_back_levy_ids uuid[],
  base_floor numeric(12,2),
  base_cap numeric(12,2),
  -- [{"source": "withholdings" | "paid" | "amount", "levyId": "...", "share": 100,
  -- "periodRef": "current"}].
  base_credits jsonb,
  -- How a yearly measure is read by a monthly rule and the reverse: 'none',
  -- 'per_month' (divide the reference by the months the activity was open),
  -- 'annualized' (scale a partial year up to a full one).
  base_scale text not null default 'none' check (base_scale in ('none', 'per_month', 'annualized')),

  -- Amount.
  amount_form text not null
    check (amount_form in ('rate', 'brackets', 'elective_base', 'fixed', 'none')),
  rate numeric(8,4),
  -- {"mode": "progressive" | "step", "rows": [{"upTo": 18080, "rate": 23}, ...,
  -- {"upTo": null, "rate": 49}]}; a step table may give "amount" instead of "rate".
  brackets jsonb,
  -- {"rows": [{"upTo": 670, "minBase": 653.59, "maxBase": 718.94}, ...],
  -- "inputName": "contribution_base", "rate": 31.5}.
  elective jsonb,
  fixed_amount numeric(12,2),
  fixed_input_name text,
  -- Taken off after the amount: a fixed credit, and a dated input of personal
  -- credits the engine cannot compute.
  fixed_credit numeric(12,2),
  credit_input_name text,

  -- Schedule, relative to the activity's fiscal year.
  period text not null check (period in ('month', 'quarter', 'half', 'year')),
  -- {"type": "after_period", "monthOffset": 1, "fromDay": 1, "toDay": 25} |
  -- {"type": "end_of_next_month"} |
  -- {"type": "fixed_dates", "dates": [{"month": 6, "day": 30, "yearOffset": 1}]}.
  due jsonb not null,
  -- Months between the declaration and its payment when they differ.
  declaration_lag_months smallint,
  first_due_after_days integer,
  -- Periods absorbed by another return: {"quarter": [4]} for a fourth quarter
  -- folded into the annual one.
  skip_periods jsonb,

  -- Regularisation.
  regularization text not null default 'none'
    check (regularization in ('none', 'annual_deadzone', 'provisional_then_settled')),
  regularization_params jsonb,

  -- Settlement: the expenses of the activity in this category are its payments.
  settlement_category_id uuid references category(id),
  -- Whether paying it reduces the profit: a social contribution often does, an
  -- income tax never.
  deductible boolean not null default false,
  -- Neither revenue nor charge: VAT, collected for the state and owed to it.
  pass_through boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint levy_validity check (valid_to is null or valid_to >= valid_from),
  constraint levy_rate_form check (amount_form <> 'rate' or rate is not null),
  constraint levy_brackets_form check (amount_form <> 'brackets' or brackets is not null),
  constraint levy_elective_form check (amount_form <> 'elective_base' or elective is not null),
  constraint levy_fixed_form
    check (amount_form <> 'fixed' or fixed_amount is not null or fixed_input_name is not null),
  constraint levy_base_levy_ref check ((base_measure in ('paid', 'amount')) = (base_levy_id is not null)),
  constraint levy_base_input_ref check ((base_measure = 'input') = (base_input_name is not null))
);
create index levy_activity_valid on levy (activity_id, valid_from);

-- What changes a levy for a time: a reduced rate at the start of an activity,
-- a flat amount replacing the computed one, a coefficient on the base, an
-- exemption. Eligibility is asserted by the user (`condition` says what they
-- assert), never checked here.
create table levy_modifier (
  id uuid primary key default gen_random_uuid(),
  levy_id uuid not null references levy(id) on delete cascade,
  label text not null,
  effect text not null check (effect in ('rate_factor', 'replace_amount', 'coefficient', 'exempt')),
  value numeric(12,4),
  -- Null: from the activity's started_on.
  starts_on date,
  -- At most one of the three; none for an open-ended modifier.
  duration_months integer check (duration_months is null or duration_months > 0),
  duration_periods integer check (duration_periods is null or duration_periods > 0),
  ends_on date,
  condition text,
  source_url text,
  verified_on date,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'extended_by_default', 'unconfirmed')),
  created_at timestamptz not null default now(),
  constraint levy_modifier_value_when_needed check (effect = 'exempt' or value is not null),
  constraint levy_modifier_single_duration
    check (num_nonnulls(duration_months, duration_periods, ends_on) <= 1)
);
create index levy_modifier_levy on levy_modifier (levy_id);

-- A figure the engine cannot compute and the user states, dated: the
-- contribution base they chose, last year's profit before the ledger existed,
-- a notice's amount, an estimated marginal rate. The value in force at a date
-- is the latest one on or before it.
create table activity_input (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  activity_id uuid not null references activity(id) on delete cascade,
  name text not null,
  valid_from date not null,
  value numeric(14,4) not null,
  note text,
  created_at timestamptz not null default now(),
  unique (activity_id, name, valid_from)
);

-- A threshold the regime hinges on: a measure over a period reference against
-- a value, and the sentence saying what changes past it. It alerts; the engine
-- never switches a regime on its own, because leaving a VAT exemption or a
-- flat-rate regime is a gesture (add the rule, close the activity), not a side
-- effect.
create table threshold (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  activity_id uuid not null references activity(id) on delete cascade,
  label text not null,
  measure text not null
    check (measure in ('revenue', 'revenue_incl_vat', 'expenses', 'profit', 'vat_balance',
                       'withholdings', 'withholding_share')),
  period_ref text not null default 'ytd'
    check (period_ref in ('current', 'ytd', 'year-1', 'year-2', 'rolling-12')),
  comparison text not null default 'lte' check (comparison in ('lte', 'gte')),
  value numeric(14,2) not null,
  consequence text not null,
  source_url text,
  verified_on date,
  review_on date,
  created_at timestamptz not null default now()
);
create index threshold_activity on threshold (activity_id);
