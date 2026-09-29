-- A bank card, and the statement that debits a deferred card's purchases (issue #102).
--
-- A deferred-debit card does not debit the account when something is bought:
-- the bank adds the purchases up until a cut-off day, then debits the total in
-- one go on a later day. A purchase made in September can leave the account on
-- October 31st. Declared on its purchase day, it lowers the balance at once
-- while nothing has left the bank yet, and a balance check made in between
-- reports a gap that is not one. That is the guard rail of the model going out
-- of true.
--
-- The card never carries its number. It carries the account it debits and,
-- when deferred, its cut-off day and its debit day, each with the way it moves
-- when it falls on a weekend (banks do not move them the same way). That
-- schedule only forecasts: public holidays and bank practice move the real
-- debit, which nothing here can know in advance.
--
-- So a deferred card's purchases are grouped in statements, one per cycle,
-- carrying the cut-off that closes the cycle, the debit the schedule expects,
-- and the day the bank really debited it, stated by the person when it happens.
-- A purchase is dated on its statement: the real debit once stated, the
-- expected one until then, its purchase day kept next to it. Stating the day
-- once moves every purchase of the cycle, rather than one movement at a time.
--
-- Two rules hold this in place:
--   * no balance counts a purchase whose statement has no debit day yet:
--     balances, balance checks and gap settlements are sums over happened_on
--     (0011) of what has left the account, and until the debit is stated,
--     nothing has. The expected day places it in the ledger and in the flows,
--     never in a balance;
--   * the month a purchase is about is the month it was made in, so the
--     counted month follows the purchase day when no month is declared.

create table card (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  name text not null,
  account_id uuid not null references account(id),
  -- The month printed on the card: it works through that month's last day.
  expiry_month date not null,
  debit_mode text not null check (debit_mode in ('immediate', 'deferred')),
  -- Deferred only. A day of the month, clamped to the month's last day, so 31
  -- reads "end of month" in every month.
  statement_day smallint check (statement_day between 1 and 31),
  statement_shift text check (statement_shift in ('none', 'previous', 'next')),
  debit_day smallint check (debit_day between 1 and 31),
  debit_shift text check (debit_shift in ('none', 'previous', 'next')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_expiry_is_a_month
    check (expiry_month = date_trunc('month', expiry_month::timestamp)::date),
  -- A deferred card needs its whole schedule, an immediate one has none.
  constraint card_schedule_matches_mode
    check (num_nonnulls(statement_day, statement_shift, debit_day, debit_shift)
           = case when debit_mode = 'deferred' then 4 else 0 end)
);
create unique index card_user_name on card (user_id, lower(name));
create index card_account on card (account_id);

create table card_statement (
  id uuid primary key default gen_random_uuid(),
  -- A card is deleted only once nothing was paid with it: its statements are
  -- empty by then.
  card_id uuid not null references card(id) on delete cascade,
  -- The cut-off that closes the cycle, which is what identifies it.
  cut_off_on date not null,
  -- The debit the card's schedule expects.
  due_on date not null,
  -- The day the bank debited it, stated by the person. Null until then.
  debited_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_statement_due_after_cut_off check (due_on >= cut_off_on),
  constraint card_statement_debited_after_cut_off check (debited_on is null or debited_on >= cut_off_on),
  constraint card_statement_one_per_cycle unique (card_id, cut_off_on),
  -- The target of the movement's composite key below.
  constraint card_statement_of_card unique (id, card_id)
);

alter table movement
  add column card_id uuid references card(id),
  -- Deferred card only: the day of the purchase, happened_on being the debit.
  add column purchased_on date,
  add column card_statement_id uuid,
  -- A purchase sits on a statement of the card that paid it.
  add constraint movement_statement_of_its_card
    foreign key (card_statement_id, card_id) references card_statement (id, card_id),
  -- A card pays for something or is credited a refund: it never moves money
  -- between two accounts of the same person.
  add constraint movement_transfer_has_no_card
    check (card_id is null or source_account_id is null or target_account_id is null),
  -- The person who owed an advance pays it back to the account, never to the
  -- card that paid it.
  add constraint movement_refund_has_no_card
    check (card_id is null or refunds_movement_id is null),
  -- A deferred purchase, and only one, carries both its purchase day and its
  -- statement.
  add constraint movement_deferred_purchase_whole
    check ((purchased_on is null) = (card_statement_id is null)),
  -- The composite key above is skipped when card_id is null: this closes it.
  add constraint movement_statement_needs_card
    check (card_statement_id is null or card_id is not null),
  add constraint movement_purchase_before_debit
    check (purchased_on is null or purchased_on <= happened_on);
create index movement_card on movement (card_id) where card_id is not null;
create index movement_card_statement on movement (card_statement_id) where card_statement_id is not null;

-- A subscription billed to a card: its occurrences are purchases on it.
alter table commitment
  add column card_id uuid references card(id),
  add constraint commitment_card_on_subscription
    check (card_id is null or (kind = 'subscription' and direction = 'outgoing'));

-- The counted month follows the purchase day of a deferred purchase. A
-- generated column cannot change its expression in place, so it is rebuilt,
-- its index with it.
alter table movement drop column counted_in_month;
alter table movement
  add column counted_in_month date generated always as (
    coalesce(accrual_month, date_trunc('month', coalesce(purchased_on, happened_on)::timestamp)::date)
  ) stored;
create index movement_user_counted on movement (user_id, counted_in_month);
