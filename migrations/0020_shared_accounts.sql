-- An account serves the activities that live on it (issue #89, part of #82).
--
-- 0016 hung the link on the account: one column, so one activity at most,
-- chosen the day the account was declared. The direction was the mistake. An
-- account exists before the activities that use it, and it is the activity
-- that declares what it lives on, so the gesture belongs to the activity and
-- not to the account. Sharing follows from the same reading: an independent
-- worker starting a second activity runs it on the bank account already open,
-- and opening one account per activity is a banking constraint this app has
-- no business imposing.
--
-- What a shared account changes is decided where each reading lives, in
-- packages/core/src/services: the treasury of an activity is the balance of
-- its accounts and names the ones it shares; what is payable to oneself takes
-- off the reserve of every activity resting on those same accounts, so that
-- the same euro is never promised twice; and a shared account no longer
-- designates the activity of a movement, since it designates several.
--
-- Nothing here apportions a balance: an account is whole under each activity
-- that uses it, and there is no share to state.

create table activity_account (
  -- The activity goes, its links go with it: they say what it lived on and
  -- mean nothing without it. The account stays, it was there first.
  activity_id uuid not null references activity(id) on delete cascade,
  account_id uuid not null references account(id),
  primary key (activity_id, account_id)
);

-- Read the other way round on every movement that touches an account: which
-- activities live here, and whether there is more than one.
create index activity_account_by_account on activity_account (account_id);

insert into activity_account (activity_id, account_id)
select activity_id, id from account where activity_id is not null;

alter table account drop column activity_id;
