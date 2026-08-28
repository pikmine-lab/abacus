-- What an account already held before the ledger began (issue #54).
--
-- Taking over an account that already exists means starting from a known
-- balance, without replaying years of history nobody will ever type in.
-- Without a column for it, that money can only enter as a movement coming from
-- a made-up actor, therefore as income: the first month shows a huge revenue
-- that never happened, every month-to-month comparison starts skewed, and the
-- actor catalogue carries an entry that designates nobody.
--
-- It is not a movement: no counterparty, no category, no derived nature. Only
-- balances read it, and no analysis of flows ever will. The balance of an
-- account on a day is its opening plus its movements up to that day, which is
-- what makes the first balance check report no gap instead of reporting the
-- whole history that precedes the ledger.
--
-- A non-zero opening carries the day it holds from, which is the day the
-- account enters the balances: before it the account weighs nothing here, and
-- a check dated earlier compares against nothing. Zero needs no day, so an
-- account can still be declared without one.
--
-- Negative is legitimate: an account taken over while overdrawn. On an
-- investment account the opening carries the cash, and counts as money put in,
-- so it is no performance; the positions already held are declared by their
-- purchase operations, which make their cost basis.

alter table account
  add column opening_balance numeric(12,2) not null default 0,
  add constraint account_opening_needs_its_day
    check (opening_balance = 0 or opened_on is not null);
