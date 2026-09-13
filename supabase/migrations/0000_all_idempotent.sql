-- RecruitingLine :: complete schema, safe to run repeatedly.
-- Supersedes 0001-0003 for a one-shot apply. Re-running is a no-op.

-- RecruitingLine :: initial schema
-- Run with `supabase db push`, or paste into the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Human disposition chosen in the exit interview. This is the CRM "response".
do $$ begin
  if not exists (select 1 from pg_type where typname = 'call_outcome') then
    create type call_outcome as enum (
      'meeting_booked',
      'not_interested',
      'wrong_number',
      'call_back'
    );
  end if;
end $$;

-- Machine-recorded result of a dial. Distinct from the human outcome: a call
-- can be `connected` and still have no outcome (agent skipped the interview).
do $$ begin
  if not exists (select 1 from pg_type where typname = 'call_status') then
    create type call_status as enum (
      'dialing',    -- REST call created, not yet ringing
      'ringing',
      'connected',  -- won the batch, bridged to the agent
      'no_answer',
      'busy',
      'failed',
      'voicemail',  -- answering-machine detection fired
      'canceled'    -- lost the race, hung up before the agent ever heard it
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('rep', 'manager', 'admin');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles (mirror of auth.users)
-- ---------------------------------------------------------------------------

create table if not exists profiles (
  id         uuid primary key references auth.users on delete cascade,
  full_name  text not null default '',
  email      text,
  role       user_role not null default 'rep',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Companies :: the CRM rows
-- ---------------------------------------------------------------------------

create table if not exists companies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  city           text,
  state          text,                       -- 2-letter US code
  phone          text not null,              -- E.164, e.g. +12125550123
  owner_id       uuid references profiles(id) on delete set null,

  -- Denormalized from calls by trigger. Never write these by hand.
  response       call_outcome,               -- latest human disposition
  call_count     integer not null default 0,
  last_called_at timestamptz,

  next_follow_up date,
  notes          text not null default '',
  do_not_call    boolean not null default false,
  timezone       text,                       -- IANA; gates calling hours
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One company per phone number. The importer upserts on this, which is what
-- keeps the dialer from calling the same switchboard twice in one session.
create unique index if not exists companies_phone_key on companies (phone);
create index if not exists companies_owner_idx       on companies (owner_id);
create index if not exists companies_followup_idx    on companies (next_follow_up) where do_not_call = false;
create index if not exists companies_name_lower_idx   on companies (lower(name));

-- ---------------------------------------------------------------------------
-- Dialer sessions and batches
-- ---------------------------------------------------------------------------

create table if not exists call_sessions (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid not null references profiles(id) on delete cascade,
  conference_name text not null unique,
  lines_per_batch smallint not null default 4 check (lines_per_batch between 1 and 6),
  status          text not null default 'active' check (status in ('active','ended')),
  started_at      timestamptz not null default now(),
  ended_at        timestamptz
);

create index if not exists call_sessions_agent_idx on call_sessions (agent_id, started_at desc);

-- One batch == one simultaneous fan-out of N lines. `winner_call_id` is the
-- race arbiter: the first webhook to CAS it from null wins and gets bridged.
create table if not exists dial_batches (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references call_sessions(id) on delete cascade,
  seq            integer not null,
  winner_call_id uuid,                       -- FK added below (circular)
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  unique (session_id, seq)
);

-- ---------------------------------------------------------------------------
-- Calls :: one row per dial attempt, winners and losers alike
-- ---------------------------------------------------------------------------

create table if not exists calls (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  agent_id           uuid references profiles(id) on delete set null,
  session_id         uuid references call_sessions(id) on delete set null,
  batch_id           uuid references dial_batches(id) on delete set null,

  call_sid           text unique,            -- Twilio CallSid
  status             call_status not null default 'dialing',
  amd_result         text,                   -- human | machine_start | unknown
  outcome            call_outcome,           -- exit interview
  notes              text,

  started_at         timestamptz not null default now(),
  answered_at        timestamptz,
  ended_at           timestamptz,
  duration_seconds   integer,

  recording_sid      text,
  recording_path     text,                   -- Supabase Storage object path
  recording_duration integer,

  transcript         text,
  ai_summary         jsonb,
  ai_status          text not null default 'none'
                     check (ai_status in ('none','pending','processing','ready','failed')),
  ai_error           text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists calls_company_idx on calls (company_id, started_at desc);
create index if not exists calls_session_idx on calls (session_id, started_at desc);
create index if not exists calls_batch_idx   on calls (batch_id);
create index if not exists calls_ai_queue_idx on calls (ai_status) where ai_status in ('pending','processing');

alter table dial_batches drop constraint if exists dial_batches_winner_fk;
alter table dial_batches
  add constraint dial_batches_winner_fk
  foreign key (winner_call_id) references calls(id) on delete set null;

-- ---------------------------------------------------------------------------
-- updated_at housekeeping
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists companies_touch on companies;
create trigger companies_touch
 before update on companies
  for each row execute function public.touch_updated_at();
drop trigger if exists calls_touch on calls;
create trigger calls_touch
 before update on calls
  for each row execute function public.touch_updated_at();
-- RecruitingLine :: rollups, dialer RPCs, row-level security

-- ---------------------------------------------------------------------------
-- Company rollup :: keeps the CRM table a single-query read (no N+1)
-- ---------------------------------------------------------------------------
-- `canceled` calls are losing legs of a parallel batch. The prospect never
-- heard us, so they must not inflate call_count or move last_called_at.

create or replace function public.sync_company_rollup()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target uuid := coalesce(new.company_id, old.company_id);
begin
  update companies c set
    call_count = (
      select count(*) from calls
       where company_id = target and status <> 'canceled'
    ),
    last_called_at = (
      select max(started_at) from calls
       where company_id = target and status <> 'canceled'
    ),
    response = (
      select outcome from calls
       where company_id = target and outcome is not null
       order by coalesce(ended_at, answered_at, started_at) desc
       limit 1
    )
  where c.id = target;
  return null;
end;
$$;

drop trigger if exists calls_sync_company on calls;
create trigger calls_sync_company
  after insert or update of status, outcome, ended_at or delete on calls
  for each row execute function public.sync_company_rollup();

-- ---------------------------------------------------------------------------
-- claim_batch_winner :: THE race arbiter
-- ---------------------------------------------------------------------------
-- Four legs can answer within milliseconds of each other. Postgres decides,
-- not application code: the UPDATE ... WHERE winner IS NULL is atomic, so
-- exactly one caller gets a row back and every other caller gets false.

create or replace function public.claim_batch_winner(p_batch_id uuid, p_call_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  won boolean;
begin
  update dial_batches
     set winner_call_id = p_call_id,
         resolved_at    = now()
   where id = p_batch_id
     and winner_call_id is null
  returning true into won;

  return coalesce(won, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- start_dial_batch :: pick the next N leads AND reserve them, atomically
-- ---------------------------------------------------------------------------
-- Selection and reservation have to happen in one transaction. If we merely
-- returned leads and inserted the call rows on a later round trip, two reps
-- dialing at the same moment could both be handed the same company -- SKIP
-- LOCKED only holds for the life of the transaction. So this creates the
-- batch, picks the leads, and writes placeholder `dialing` call rows in one
-- shot. The caller then fires Twilio and patches each row with its CallSid.

create or replace function public.start_dial_batch(
  p_session uuid,
  p_agent   uuid,
  p_limit   integer default 4
)
returns table (
  call_id      uuid,
  batch_id     uuid,
  company_id   uuid,
  company_name text,
  phone        text
)
language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid;
  v_seq   integer;
begin
  select coalesce(max(seq), 0) + 1 into v_seq
    from dial_batches where session_id = p_session;

  insert into dial_batches (session_id, seq)
  values (p_session, v_seq)
  returning id into v_batch;

  return query
  with picked as (
    select c.id, c.name, c.phone
      from companies c
     where c.do_not_call = false
       and c.phone is not null
       and (c.owner_id = p_agent or c.owner_id is null)
       and (c.next_follow_up is null or c.next_follow_up <= current_date)
       and (c.response is null or c.response = 'call_back')
       -- not already dialed in this session
       and not exists (
         select 1 from calls k
          where k.company_id = c.id and k.session_id = p_session
       )
       -- not in flight for anyone else right now
       and not exists (
         select 1 from calls k
          where k.company_id = c.id
            and k.status in ('dialing','ringing','connected')
            and k.started_at > now() - interval '2 minutes'
       )
     order by
       (c.next_follow_up is not null) desc,   -- overdue follow-ups first
       c.next_follow_up asc nulls last,
       c.last_called_at asc nulls first,      -- then never-called
       c.created_at asc
     limit p_limit
     for update skip locked
  ), reserved as (
    insert into calls (company_id, agent_id, session_id, batch_id, status)
    select p.id, p_agent, p_session, v_batch, 'dialing'
      from picked p
    returning calls.id, calls.company_id
  )
  select r.id, v_batch, r.company_id, p.name, p.phone
    from reserved r
    join picked p on p.id = r.company_id;

  -- An empty batch means the queue is dry; don't leave a stub behind.
  if not found then
    delete from dial_batches where id = v_batch;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- Shared book: every authenticated teammate can READ the whole CRM (the owner
-- column is meaningless otherwise). Writes are restricted to the owner, or to
-- anyone if the row is unclaimed. Managers and admins can write anything.

alter table profiles      enable row level security;
alter table companies     enable row level security;
alter table call_sessions enable row level security;
alter table dial_batches  enable row level security;
alter table calls         enable row level security;

create or replace function public.is_privileged()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
     where id = auth.uid() and role in ('manager','admin')
  );
$$;

-- profiles
drop policy if exists profiles_read_all on profiles;
create policy profiles_read_all on profiles
  for select to authenticated using (true);
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- companies
drop policy if exists companies_read_all on companies;
create policy companies_read_all on companies
  for select to authenticated using (true);
drop policy if exists companies_insert on companies;
create policy companies_insert on companies
  for insert to authenticated with check (true);
drop policy if exists companies_update on companies;
create policy companies_update on companies
  for update to authenticated
  using (owner_id is null or owner_id = auth.uid() or public.is_privileged());
drop policy if exists companies_delete on companies;
create policy companies_delete on companies
  for delete to authenticated using (public.is_privileged());

-- call_sessions :: yours, unless you're privileged
drop policy if exists sessions_read on call_sessions;
create policy sessions_read on call_sessions
  for select to authenticated
  using (agent_id = auth.uid() or public.is_privileged());
drop policy if exists sessions_write on call_sessions;
create policy sessions_write on call_sessions
  for all to authenticated
  using (agent_id = auth.uid()) with check (agent_id = auth.uid());

-- dial_batches :: readable through your own session
drop policy if exists batches_read on dial_batches;
create policy batches_read on dial_batches
  for select to authenticated
  using (
    exists (
      select 1 from call_sessions s
       where s.id = session_id
         and (s.agent_id = auth.uid() or public.is_privileged())
    )
  );

-- calls :: the whole team can read call history (that's the company page),
-- but only the agent who made the call can amend it.
drop policy if exists calls_read_all on calls;
create policy calls_read_all on calls
  for select to authenticated using (true);
drop policy if exists calls_update_own on calls;
create policy calls_update_own on calls
  for update to authenticated
  using (agent_id = auth.uid() or public.is_privileged());

-- NOTE: no INSERT policy for calls, and no policy at all for the service
-- paths. Every write that originates from a Twilio webhook goes through the
-- service-role key on the server, which bypasses RLS by design. The browser
-- can never fabricate a call row.

-- ---------------------------------------------------------------------------
-- Recording storage :: private bucket, served through signed URLs only
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

drop policy if exists recordings_read on storage.objects;
create policy recordings_read on storage.objects
  for select to authenticated
  using (bucket_id = 'recordings');
-- The dialer shows four lines changing state within a couple of seconds of
-- each other. Polling that would either lag visibly or hammer the database, so
-- the call rows are published over Realtime and the UI subscribes to its own
-- session. RLS still applies to Realtime, so a rep only ever receives rows
-- they are allowed to read.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'calls'
    ) then
      execute 'alter publication supabase_realtime add table public.calls';
    end if;
  end if;
end
$$;

-- Realtime needs the full old row to compute payloads for updates.
alter table calls replica identity full;
