-- A return filed with nothing to pay, against the due date it answers.
--
-- A rule computed on the activity's own figures is filed on a return that
-- states them, and that return is owed even when they come to zero. The
-- schedule lists the period for that reason, and a payment is what answers it;
-- but no payment of zero can be written (a movement's amount is positive), so
-- a period with nothing in it stayed overdue for good. This row answers it
-- instead: the user says the return was filed at zero, as a payment says the
-- money left.
--
-- It names its due date with the same four values a payment does (see 0022),
-- once. It answers that due date only while the estimate stays at zero: a
-- receipt recorded after the fact brings the period back as owed, rather than
-- leaving a zero return standing over money the facts say is due.
--
-- It carries no date. What the schedule needs is that the return was filed,
-- and a day typed now for a return filed months ago would be a second fact,
-- a false one. And it goes with its rule: unlike a payment, it is no money the
-- history has to keep.

create table levy_nil_return (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth_user(id),
  levy_id uuid not null references levy(id) on delete cascade,
  entry text not null check (entry in ('period', 'regularization')),
  period_start date not null,
  instalment smallint not null check (instalment > 0),
  created_at timestamptz not null default now(),
  unique (levy_id, entry, period_start, instalment)
);
