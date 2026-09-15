-- RecruitingLine :: one lead list, CRM as a subset, no duplicates.
-- Safe to run repeatedly. Requires 0004_leads.sql and 0007_company_email.sql.
--
-- Every company is a lead. A lead is "in the CRM" once it has been contacted:
-- `reached_out` flips to true when a real call is placed (0004 trigger) or
-- when a rep adds it from the Leads page. Because both views read the same
-- table, the CRM can never contain something the lead list doesn't.

begin;

-- Leads can be imported before anyone has a number for them. The dialer
-- already skips companies without a phone (start_dial_batch: phone is not null),
-- and companies_phone_key still allows only one company per number.
alter table companies alter column phone drop not null;

-- Business-name dedupe key. Two names are the same business when they match
-- after lowercasing, treating & as "and", dropping punctuation (L.L.C. = LLC), a leading
-- "the", and trailing legal suffixes. "MARICOPA AIR, LLC" = "Maricopa Air".
-- lib/leads/dedupe.ts implements the identical rules for imports.
create or replace function public.company_name_key(p_name text)
returns text language sql immutable parallel safe as $$
  select coalesce(
    nullif(
      replace(
        regexp_replace(
          regexp_replace(
            ' ' || trim(regexp_replace(replace(regexp_replace(lower(coalesce(p_name, '')), '[.''’]', '', 'g'), '&', ' and '), '[^a-z0-9]+', ' ', 'g')) || ' ',
            '^ the ', ' '
          ),
          '( (llc|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pllc|pc|dba))+ $', ' '
        ),
        ' ', ''
      ),
      ''
    ),
    regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '', 'g')
  );
$$;

alter table companies
  add column if not exists name_key text generated always as (public.company_name_key(name)) stored;

-- Refuse to create the constraint over existing duplicates; say which ones.
do $$
declare
  v_dupes text;
begin
  select string_agg(format('%s (%s rows)', min_name, n), ', ')
    into v_dupes
    from (
      select min(name) as min_name, count(*) as n
        from companies
       group by name_key
      having count(*) > 1
    ) d;

  if v_dupes is not null then
    raise exception 'Duplicate business names must be merged before this migration can finish: %', v_dupes;
  end if;
end
$$;

create unique index if not exists companies_name_key_key on companies (name_key);

-- The CRM is only ever a subset of Leads, and a company that has actually been
-- called stays in it: un-marking it would hide real call history.
create or replace function public.keep_contacted_in_crm()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.reached_out = false and exists (
    select 1 from calls k where k.company_id = new.id and k.status <> 'canceled'
  ) then
    new.reached_out := true;
  end if;
  return new;
end;
$$;

drop trigger if exists companies_keep_contacted_in_crm on companies;
create trigger companies_keep_contacted_in_crm
  before update of reached_out on companies
  for each row execute function public.keep_contacted_in_crm();

commit;
