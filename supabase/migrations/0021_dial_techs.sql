-- RecruitingLine :: dial techs from the dialer. Safe to run repeatedly.
--
-- A call can now be to a tech instead of a company. company_id becomes
-- nullable and tech_id is added; the company rollup triggers already do
-- nothing for a null company. A session carries which queue it dials.

alter table calls alter column company_id drop not null;
alter table calls add column if not exists tech_id uuid references techs(id) on delete cascade;
create index if not exists calls_tech_idx on calls (tech_id, started_at desc);

alter table call_sessions add column if not exists queue text not null default 'companies'
  check (queue in ('companies', 'techs'));

-- Techs eligible to dial: has a phone, not placed or rejected, follow-up
-- due, not dialed in the last 20 hours, not in flight. Newest applicants first.
alter table techs add column if not exists next_follow_up date;

drop function if exists public.start_tech_batch(uuid, uuid, integer);
create or replace function public.start_tech_batch(
  p_session uuid,
  p_agent uuid,
  p_limit integer default 4
)
returns table (
  call_id uuid,
  batch_id uuid,
  tech_id uuid,
  tech_name text,
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
    select t.id, t.name, t.city, t.title, t.phone
      from techs t
     where t.phone is not null
       and t.status::text in ('new', 'reviewing', 'contacting', 'interviewing')
       and (t.next_follow_up is null or t.next_follow_up <= current_date)
       and not exists (
         select 1 from calls k
          where k.tech_id = t.id and k.session_id = p_session
       )
       and not exists (
         select 1 from calls k
          where k.tech_id = t.id
            and k.status in ('dialing','ringing','connected')
            and k.started_at > now() - interval '2 minutes'
       )
       and not exists (
         select 1 from calls k
          where k.tech_id = t.id
            and k.status <> 'canceled'
            and k.started_at > now() - interval '20 hours'
       )
     order by
       (t.next_follow_up is not null) desc,
       t.next_follow_up asc nulls last,
       t.applied_at desc nulls last,
       t.created_at desc
     limit p_limit
     for update skip locked
  ), reserved as (
    insert into calls (tech_id, agent_id, session_id, batch_id, status)
    select p.id, p_agent, p_session, v_batch, 'dialing'
      from picked p
    returning calls.id, calls.tech_id
  )
  select r.id, v_batch, r.tech_id,
         coalesce(nullif(p.name, ''), coalesce(p.title, 'Applicant') || coalesce(' · ' || p.city, '')),
         p.phone
    from reserved r
    join picked p on p.id = r.tech_id;

  v_any := found;
  if not v_any then
    delete from dial_batches where id = v_batch;
  end if;
end;
$$;

notify pgrst, 'reload schema';
