-- RecruitingLine :: contact email on a company. Safe to run repeatedly.
--
-- Captured in the exit interview right after a call ("send me something"),
-- editable on the company page, and importable from a CSV `email` column.

alter table companies add column if not exists email text;
