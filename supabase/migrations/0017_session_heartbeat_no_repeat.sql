-- RecruitingLine :: session heartbeat + no same-day repeat dials. Safe to run repeatedly.
--
-- last_seen_at is refreshed by the dialer while it is open. Starting a new
-- session refuses to cut off one that is still alive, which is what happened
-- when two people dialed under one login.
--
-- start_dial_batch also gains a rule: a company that has had a real dial in
-- the last 20 hours is not picked again, by anyone.

alter table call_sessions add column if not exists last_seen_at timestamptz not null default now();

-- Drop first: `create or replace` cannot change a function's result columns,
-- and a database that got this function from an older script refuses the
-- replace ("cannot change return type of existing function"). Nothing grants
-- on it explicitly, and the drop + create run in one transaction, so the
-- dialer never sees it missing.
begin;
drop function if exists public.start_dial_batch(uuid, uuid, integer);

create or replace function public.start_dial_batch(
  p_session uuid,
  p_agent uuid,
  p_limit integer default 4
)
returns table (
  call_id uuid,
  batch_id uuid,
  company_id uuid,
  company_name text,
  phone text
)
language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid;
  v_seq integer;
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
       and (c.next_follow_up is null or c.next_follow_up <= current_date)
       -- ::text so this body never references an enum value added in the
       -- same transaction, which Postgres refuses.
       and (c.response is null or c.response::text in ('call_back', 'no_answer', 'not_interested', 'not_hiring'))
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
       -- one real dial per company per day, across every rep. A company that
       -- rang and went unanswered comes back tomorrow, not the same afternoon.
       and not exists (
         select 1 from calls k
          where k.company_id = c.id
            and k.status <> 'canceled'
            and k.started_at > now() - interval '20 hours'
       )
     order by
       c.priority desc, -- starred "call first" leads, then the normal order
       (c.next_follow_up is not null) desc, -- overdue follow-ups first
       c.next_follow_up asc nulls last,
       c.last_called_at asc nulls first, -- then never-called
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

  -- A starred lead is a one-time bump: once it has been handed to a rep the
  -- star comes off, so the next time it is due it queues like anyone else.
  update companies set priority = false
   where priority = true
     and id in (select k.company_id from calls k where k.batch_id = v_batch);

  -- An empty batch means the queue is dry; don't leave a stub behind.
  if not found then
    delete from dial_batches where id = v_batch;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
