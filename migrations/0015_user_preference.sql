-- The reading a person counts in, settled once instead of re-chosen per screen (issue #75).
--
-- Which month a movement counts in has two legitimate answers (see 0011), and
-- until now the choice lived in each screen's URL and fell back to cash on
-- every navigation. Someone who reasons in the month a movement is about had
-- to redo the gesture screen after screen, and could read two screens in two
-- different readings without anything saying so: it is the figures themselves
-- that become doubtful, not just the walk between screens.
--
-- This table holds the value a session opens in, and only that. A screen's
-- switch is punctual and never writes here: a glance in the other reading
-- would otherwise redefine what the person counts in, which is not what the
-- gesture announced. Changing the starting value is its own gesture, in the
-- preferences.
--
-- No row means the defaults. Nobody is created here at signup, so a user who
-- never expressed a preference reads exactly like one who chose cash.
--
-- The boundary of 0011 holds: this is a reading of flows over a period, and it
-- never reaches a balance, which has one reading and only one.
--
-- One row per user, one column per preference: what a person counts in is not
-- the only thing they will settle once, and the next one lands here rather
-- than in a second table.

create table user_preference (
  user_id text primary key references auth_user(id),
  reading text not null default 'cash' check (reading in ('cash', 'accrual')),
  updated_at timestamptz not null default now()
);
