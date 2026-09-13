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
create policy profiles_read_all on profiles
  for select to authenticated using (true);
create policy profiles_update_self on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- companies
create policy companies_read_all on companies
  for select to authenticated using (true);
create policy companies_insert on companies
  for insert to authenticated with check (true);
create policy companies_update on companies
  for update to authenticated
  using (owner_id is null or owner_id = auth.uid() or public.is_privileged());
create policy companies_delete on companies
  for delete to authenticated using (public.is_privileged());

-- call_sessions :: yours, unless you're privileged
create policy sessions_read on call_sessions
  for select to authenticated
  using (agent_id = auth.uid() or public.is_privileged());
create policy sessions_write on call_sessions
  for all to authenticated
  using (agent_id = auth.uid()) with check (agent_id = auth.uid());

-- dial_batches :: readable through your own session
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
create policy calls_read_all on calls
  for select to authenticated using (true);
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

create policy recordings_read on storage.objects
  for select to authenticated
  using (bucket_id = 'recordings');
