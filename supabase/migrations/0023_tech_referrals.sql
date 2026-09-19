-- RecruitingLine :: referrals. Safe to run repeatedly.
--
-- "Know anyone else looking?" is the cheapest lead in recruiting, so a name
-- and number taken mid-call becomes a tech row with a trail back to whoever
-- named them.

alter table techs add column if not exists referred_by_tech_id uuid references techs(id) on delete set null;
alter table techs add column if not exists referred_by text;  -- free text when the source is a company or a person we don't track
create index if not exists techs_referred_by_idx on techs (referred_by_tech_id);

notify pgrst, 'reload schema';
