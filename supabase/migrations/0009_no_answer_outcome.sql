-- RecruitingLine :: "did not answer" disposition. Safe to run repeatedly.
--
-- Voicemail and nobody-home pickups get their own outcome. Saving it sets the
-- company's next_follow_up to tomorrow, and the dial queue treats it like a
-- call-back, so the lead comes around again on its own.

alter type call_outcome add value if not exists 'no_answer';

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
       and (c.response is null or c.response::text in ('call_back', 'no_answer'))
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

  -- An empty batch means the queue is dry; don't leave a stub behind.
  if not found then
    delete from dial_batches where id = v_batch;
  end if;
end;
$$;
