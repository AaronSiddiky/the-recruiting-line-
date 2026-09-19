-- RecruitingLine :: tech pipeline, screening, matching, weekly touch points. Safe to run repeatedly.
--
-- Stages: new → contacting → screened → interviewing (tech interview) →
-- presented (to a client) → placed, or rejected. 'reviewing' is kept for
-- rows imported with Indeed's status.

-- 1. Stages --------------------------------------------------------------------
alter table techs drop constraint if exists techs_status_check;
alter table techs add constraint techs_status_check
  check (status in ('new', 'reviewing', 'contacting', 'screened', 'interviewing', 'presented', 'placed', 'rejected'));

-- 2. Screening card on the tech -------------------------------------------------
alter table techs add column if not exists years_hvac numeric(4,1);
alter table techs add column if not exists epa_cert text check (epa_cert in ('none', 'type1', 'type2', 'type3', 'universal'));
alter table techs add column if not exists role_pref text check (role_pref in ('install', 'service', 'both'));
alter table techs add column if not exists own_tools boolean;
alter table techs add column if not exists drivers_license boolean;
alter table techs add column if not exists commission_ok boolean;
alter table techs add column if not exists pay_min integer;            -- $/hour they need
alter table techs add column if not exists available_from date;
alter table techs add column if not exists max_commute_miles integer default 30;
alter table techs add column if not exists rating smallint check (rating between 1 and 5);
alter table techs add column if not exists interview_at timestamptz;
alter table techs add column if not exists interview_notes text;
alter table techs add column if not exists last_touch_at timestamptz;

-- 3. Requirements on the client, same vocabulary --------------------------------
alter table clients add column if not exists role_type text check (role_type in ('install', 'service', 'both'));
alter table clients add column if not exists requires_own_tools boolean;
alter table clients add column if not exists commission_pay boolean;
alter table clients add column if not exists min_years numeric(4,1);
alter table clients add column if not exists epa_required boolean;
alter table clients add column if not exists pay_min integer;
alter table clients add column if not exists pay_max integer;
alter table clients add column if not exists openings integer not null default 1;

-- 4. Touch points with a tech ---------------------------------------------------
create table if not exists tech_touchpoints (
  id uuid primary key default gen_random_uuid(),
  tech_id uuid not null references techs(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  at timestamptz not null default now(),
  channel text not null default 'call' check (channel in ('call', 'email', 'text', 'meeting', 'other')),
  summary text not null,
  next_touch date,
  call_id uuid references calls(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists tech_touchpoints_tech_idx on tech_touchpoints (tech_id, at desc);
alter table tech_touchpoints enable row level security;
drop policy if exists tech_touchpoints_all on tech_touchpoints;
create policy tech_touchpoints_all on tech_touchpoints for all to authenticated using (true) with check (true);

-- Every touch schedules the next one: a week out unless the rep chose a date.
create or replace function public.tech_touch_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update techs
     set last_touch_at = greatest(coalesce(last_touch_at, new.at), new.at),
         next_follow_up = coalesce(new.next_touch, (new.at at time zone 'America/New_York')::date + 7)
   where id = new.tech_id;
  return null;
end;
$$;
drop trigger if exists tech_touchpoints_schedule on tech_touchpoints;
create trigger tech_touchpoints_schedule after insert on tech_touchpoints
  for each row execute function public.tech_touch_schedule();

-- 5. Presenting a tech to a client ----------------------------------------------
create table if not exists tech_presentations (
  id uuid primary key default gen_random_uuid(),
  tech_id uuid not null references techs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  status text not null default 'proposed'
    check (status in ('proposed', 'presented', 'interviewing', 'hired', 'declined')),
  match_score integer,
  notes text not null default '',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tech_id, client_id)
);
drop trigger if exists tech_presentations_touch on tech_presentations;
create trigger tech_presentations_touch before update on tech_presentations
  for each row execute function public.touch_updated_at();
alter table tech_presentations enable row level security;
drop policy if exists tech_presentations_all on tech_presentations;
create policy tech_presentations_all on tech_presentations for all to authenticated using (true) with check (true);

-- 6. The tech dial queue includes every live stage --------------------------------
create or replace function public.start_tech_batch(
  p_session uuid,
  p_agent uuid,
  p_limit integer default 4
)
returns table (call_id uuid, batch_id uuid, tech_id uuid, tech_name text, phone text)
language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid;
  v_seq integer;
  v_any boolean;
begin
  select coalesce(max(seq), 0) + 1 into v_seq from dial_batches where session_id = p_session;
  insert into dial_batches (session_id, seq) values (p_session, v_seq) returning id into v_batch;

  return query
  with picked as (
    select t.id, t.name, t.city, t.title, t.phone
      from techs t
     where t.phone is not null
       and t.status::text in ('new', 'reviewing', 'contacting', 'screened', 'interviewing', 'presented')
       and (t.next_follow_up is null or t.next_follow_up <= current_date)
       and not exists (select 1 from calls k where k.tech_id = t.id and k.session_id = p_session)
       and not exists (select 1 from calls k where k.tech_id = t.id and k.status in ('dialing','ringing','connected') and k.started_at > now() - interval '2 minutes')
       and not exists (select 1 from calls k where k.tech_id = t.id and k.status <> 'canceled' and k.started_at > now() - interval '20 hours')
     order by
       (t.next_follow_up is not null) desc,   -- weekly touches that are due first
       t.next_follow_up asc nulls last,
       t.applied_at desc nulls last,
       t.created_at desc
     limit p_limit
     for update skip locked
  ), reserved as (
    insert into calls (tech_id, agent_id, session_id, batch_id, status)
    select p.id, p_agent, p_session, v_batch, 'dialing' from picked p
    returning calls.id, calls.tech_id
  )
  select r.id, v_batch, r.tech_id,
         coalesce(nullif(p.name, ''), coalesce(p.title, 'Applicant') || coalesce(' · ' || p.city, '')),
         p.phone
    from reserved r join picked p on p.id = r.tech_id;

  v_any := found;
  if not v_any then
    delete from dial_batches where id = v_batch;
  end if;
end;
$$;

-- 7. Grand Canyon's requirements, from the signed contract ---------------------------
update clients c
   set role_type = coalesce(c.role_type, 'install'),
       requires_own_tools = coalesce(c.requires_own_tools, true),
       commission_pay = coalesce(c.commission_pay, true)
  from companies co
 where co.id = c.company_id and co.name = 'Grand Canyon Home Services';
update companies set city = 'Peoria' where name = 'Grand Canyon Home Services' and city is null;

notify pgrst, 'reload schema';
