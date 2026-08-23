-- Foreign-currency movements (issue #10).
--
-- The account is in euros, so `amount` stays what actually hit the account:
-- every balance in the app is a bare sum over it, and the bank statement is
-- the reality it is checked against. What the user paid abroad is carried
-- alongside, never instead: 99 USD is the declaration, the EUR figure is its
-- counter-value at the transaction day's rate, frozen at declaration (SPEC's
-- call: a past expense does not move with today's rate) and correctable when
-- the statement shows the bank's own conversion.
--
-- Exchange rates reuse the instrument machinery whole: a pair is one more
-- quoted thing nobody owns ('yahoo', 'USDEUR=X'), its daily closes land in
-- instrument_price like any security's, hence the third kind.

alter table instrument drop constraint instrument_kind_check;
alter table instrument add constraint instrument_kind_check
  check (kind in ('security', 'crypto', 'currency'));

-- A commitment can be billed in a foreign currency too (commitment.currency,
-- laid out in 0002, finally serves): each occurrence converts like any
-- movement. Its dated events state amounts in the currency of their day,
-- which a price change can move, so each event carries its own.
alter table commitment_event add column currency char(3);

alter table movement
  add column original_amount numeric(12,2) check (original_amount > 0),
  add column original_currency char(3),
  -- An amount without its currency could not be read out loud, and a currency
  -- without an amount says nothing.
  add constraint movement_original_is_paired
    check ((original_amount is null) = (original_currency is null)),
  -- "Originally in euros" would be a second copy of amount, not an original.
  add constraint movement_original_is_foreign
    check (original_currency is null or original_currency <> currency);
