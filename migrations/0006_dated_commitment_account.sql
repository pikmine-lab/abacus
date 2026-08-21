-- The account a commitment hits becomes a dated history, like its amount. A
-- recurring payment that moves to another account is an event, not a typo: it
-- is usually known before it takes effect, and an occurrence confirmed late
-- must still land on the account the money really left. A single current-state
-- column can say neither, and wrote a late occurrence on the wrong account in
-- silence.
--
-- `commitment.account_id` is now the account it started on; every later move is
-- an `account_changed` event carrying its effective date, and the account of an
-- occurrence is the one in force on that occurrence's own date. Reads expose
-- the account in force today, so nothing outside the datasource needs to know
-- the history exists.

alter table commitment_event
  add column account_id uuid references account(id);

alter table commitment_event
  drop constraint commitment_event_type_check,
  add constraint commitment_event_type_check
    check (type in ('created', 'price_changed', 'judgment_changed', 'cancelled', 'account_changed')),
  -- A move with no destination would silently read as "no move at all".
  add constraint commitment_event_account_changed_has_account
    check (type <> 'account_changed' or account_id is not null);

create index commitment_event_account_changed
  on commitment_event (commitment_id, occurred_on desc)
  where type = 'account_changed';
