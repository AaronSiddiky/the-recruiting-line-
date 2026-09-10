-- RecruitingLine :: initial schema
-- Run with `supabase db push`, or paste into the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Human disposition chosen in the exit interview. This is the CRM "response".
create type call_outcome as enum (
  'meeting_booked',
  'not_interested',
  'wrong_number',
  'call_back'
);

-- Machine-recorded result of a dial. Distinct from the human outcome: a call
-- can be `connected` and still have no outcome (agent skipped the interview).
create type call_status as enum (
  'dialing',    -- REST call created, not yet ringing
  'ringing',
  'connected',  -- won the batch, bridged to the agent
  'no_answer',
  'busy',
  'failed',
  'voicemail',  -- answering-machine detection fired
  'canceled'    -- lost the race; hung up before the agent ever heard it
);

create type user_role as enum ('rep', 'manager', 'admin');

-- ---------------------------------------------------------------------------
-- Profiles (mirror of auth.users)
-- ---------------------------------------------------------------------------

create table profiles (
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Companies :: the CRM rows
-- ---------------------------------------------------------------------------

create table companies (
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
create unique index companies_phone_key on companies (phone);
create index companies_owner_idx       on companies (owner_id);
create index companies_followup_idx    on companies (next_follow_up) where do_not_call = false;
create index companies_name_lower_idx   on companies (lower(name));

-- ---------------------------------------------------------------------------
-- Dialer sessions and batches
-- ---------------------------------------------------------------------------

create table call_sessions (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid not null references profiles(id) on delete cascade,
  conference_name text not null unique,
  lines_per_batch smallint not null default 4 check (lines_per_batch between 1 and 6),
  status          text not null default 'active' check (status in ('active','ended')),
  started_at      timestamptz not null default now(),
  ended_at        timestamptz
);

create index call_sessions_agent_idx on call_sessions (agent_id, started_at desc);

-- One batch == one simultaneous fan-out of N lines. `winner_call_id` is the
-- race arbiter: the first webhook to CAS it from null wins and gets bridged.
create table dial_batches (
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

create table calls (
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

create index calls_company_idx on calls (company_id, started_at desc);
create index calls_session_idx on calls (session_id, started_at desc);
create index calls_batch_idx   on calls (batch_id);
create index calls_ai_queue_idx on calls (ai_status) where ai_status in ('pending','processing');

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

create trigger companies_touch before update on companies
  for each row execute function public.touch_updated_at();
create trigger calls_touch before update on calls
  for each row execute function public.touch_updated_at();
