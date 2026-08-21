-- A balance check's gap is settled once, by one adjustment: that movement says
-- "this much was missing from the account on that day". Two of them would
-- settle the same gap twice, and correcting the check afterwards could only
-- realign one of the two.
--
-- The rule belongs here rather than in the service: it is what makes a check
-- and its adjustment a pair, which is what lets a correction propagate.

create unique index movement_one_adjustment_per_check
  on movement (balance_check_id)
  where balance_check_id is not null;
