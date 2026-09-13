-- RecruitingLine :: lead source and outreach status. Safe to run repeatedly.

alter table companies add column if not exists source text;
alter table companies add column if not exists reached_out boolean not null default false;

create index if not exists companies_reached_out_idx on companies (reached_out);

-- A real dial counts as outreach. Losing legs of a parallel batch do not: the
-- prospect never heard a ring. The flag only ever moves false -> true here, so
-- outreach logged by hand (email, LinkedIn) is never erased by a call.
create or replace function public.mark_company_reached_out()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'canceled' then
    update companies set reached_out = true
     where id = new.company_id and reached_out = false;
  end if;
  return null;
end;
$$;

drop trigger if exists calls_mark_reached_out on calls;
create trigger calls_mark_reached_out
  after insert or update of status on calls
  for each row execute function public.mark_company_reached_out();

-- Backfill from call history that already exists.
update companies c set reached_out = true
 where reached_out = false
   and exists (select 1 from calls k where k.company_id = c.id and k.status <> 'canceled');
