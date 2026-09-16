-- RecruitingLine :: fix start_dial_batch deleting live batches. Run immediately.
--
-- Since 0014, every batch that cleared no "call first" stars was deleted right
-- after being created (FOUND was read after the wrong statement). Its calls
-- lost their batch_id, claim_batch_winner could not find a session for them,
-- and the answer webhook hung up on every person who picked up.

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
  v_any boolean;
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

  -- FOUND must be read straight after RETURN QUERY: any later statement
  -- overwrites it. (0014 put the priority update in between, so a batch that
  -- dialed fine but cleared no stars was deleted, its calls lost their batch,
  -- and every answered call failed the winner check and was hung up.)
  v_any := found;

  -- A starred lead is a one-time bump: once it has been handed to a rep the
  -- star comes off, so the next time it is due it queues like anyone else.
  update companies set priority = false
   where priority = true
     and id in (select k.company_id from calls k where k.batch_id = v_batch);

  -- An empty batch means the queue is dry; don't leave a stub behind.
  if not v_any then
    delete from dial_batches where id = v_batch;
  end if;
end;
$$;

commit;


-- claim_batch_winner: fall back to the call's own session when the batch row
-- is gone, so a leg orphaned by the bug above can still be bridged.
create or replace function public.claim_batch_winner(p_batch_id uuid, p_call_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_session uuid;
  won boolean;
begin
  select session_id into v_session from dial_batches where id = p_batch_id;
  if v_session is null then
    select session_id into v_session from calls where id = p_call_id;
  end if;
  if v_session is null then
    return false;
  end if;

  update call_sessions s
     set live_call_id = p_call_id
   where s.id = v_session
     and (
       s.live_call_id is null
       or exists (select 1 from calls k where k.id = s.live_call_id and k.ended_at is not null)
     )
  returning true into won;

  if coalesce(won, false) then
    update dial_batches
       set winner_call_id = p_call_id, resolved_at = now()
     where id = p_batch_id and winner_call_id is null;
  end if;

  return coalesce(won, false);
end;
$$;

notify pgrst, 'reload schema';
