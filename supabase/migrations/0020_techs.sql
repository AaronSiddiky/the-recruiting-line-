-- RecruitingLine :: technician database. Safe to run repeatedly.
--
-- The candidates we place: HVAC techs and installers from Indeed and
-- elsewhere. Name and phone are what we chase; everything else is context.

create table if not exists techs (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text,
  email text,
  city text,
  state text,
  title text,            -- current or most recent role
  employer text,         -- current or most recent employer
  experience text,       -- free text: earlier roles, years, certs
  source text,           -- Indeed, referral, ...
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'contacting', 'interviewing', 'placed', 'rejected')),
  applied_at date,
  placed_company_id uuid references companies(id) on delete set null,
  notes text not null default '',
  owner_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists techs_phone_key on techs (phone) where phone is not null;
create index if not exists techs_status_idx on techs (status);

drop trigger if exists techs_touch on techs;
create trigger techs_touch before update on techs
  for each row execute function public.touch_updated_at();

alter table techs enable row level security;
drop policy if exists techs_all on techs;
create policy techs_all on techs for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
