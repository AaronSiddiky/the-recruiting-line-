-- RecruitingLine :: "became a customer" disposition. Safe to run repeatedly.
--
-- The stats page counts customers as companies whose latest call outcome is
-- `customer`. It is picked in the exit interview like any other outcome, so
-- the company rollup trigger and the CRM response filter need no changes.
-- Like the other terminal outcomes it drops the company out of the dial queue.

alter type call_outcome add value if not exists 'customer';
