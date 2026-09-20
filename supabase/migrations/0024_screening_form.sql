-- RecruitingLine :: the tech screening form. Safe to run repeatedly.
--
-- A link texted to a tech during the call; what they fill in lands on their
-- screening card. screening_at records when they returned it, so "sent but
-- never filled in" is visible.

alter table techs add column if not exists screening_at timestamptz;
alter table techs add column if not exists looking boolean;          -- still looking for work
alter table techs add column if not exists current_job text;        -- what they do now, in their words

notify pgrst, 'reload schema';
