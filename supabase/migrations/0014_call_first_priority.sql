-- RecruitingLine :: "call first" priority flag. Safe to run repeatedly.
--
-- Starred leads are dialed ahead of everything else; the star clears as soon
-- as the lead is handed to a rep, so it is a one-time bump and the queue goes
-- back to its normal order afterwards. Toggle it on the Leads page.

alter table companies add column if not exists priority boolean not null default false;
create index if not exists companies_priority_idx on companies (priority) where priority = true;

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


-- One-time backfill: the 40 companies hiring on Indeed as of Sep 15, 2026.
-- Harmless to re-run; anything already dialed has had its star cleared and
-- would simply be starred again, so skip this block if that has happened.
update companies set priority = true where id in (
  '8dc6a39d-e1a3-48f0-9f32-d316f2d17cda',
  'd1efb485-42a5-4b17-ba03-7b439620f49b',
  '380b91c1-0302-4df7-a07c-0f5c8fc15bc7',
  'fc0893ea-0016-4212-beab-021a58e0c4a6',
  'e691f671-b607-4d0e-8f3b-ec94aa4d76e5',
  'd69fe2f7-a77a-4ea0-8efc-0289e0e271f7',
  '67736785-5f19-40c5-a476-7798a82870ca',
  'f8df87c4-a58a-49de-8dcc-754ae634bcc0',
  '798e394a-c469-4b09-a7f6-6d48c7330225',
  'da191ad1-fa14-4f1b-8e3f-023da767fbac',
  '7ea35839-3f14-4d00-9837-185338d6e9ef',
  '499a75d2-6559-4dd3-837d-5bd068da7dde',
  '297628d6-dd4a-4096-95c2-cb033e1746ba',
  'd3ca3e96-5652-4b2e-9f5d-1589890d2d77',
  'ad6722c0-71c8-4999-9d95-af663273f28a',
  '574c820a-cf0c-4223-9a16-ea2828b88314',
  '2b58068d-88a3-4f8b-a832-a83e2c8fa502',
  '7ab864f6-4129-4fc4-9c75-4d3a86c66a3f',
  '767f95cb-847e-48cf-994d-eb526bffe44d',
  'f2398a53-a48f-4270-80d2-16516e1c1b21',
  'a3385819-309b-4d44-b92d-3b7861e1d3ec',
  '784875e7-e7e4-4f3c-80d9-b1731d916da1',
  '87031dfb-3270-420c-9817-7bffd4a649e3',
  '576f5a07-e039-46da-a0ca-818b0ebd7e5b',
  '4b814651-5198-4b23-8c42-41dfaa026a18',
  '2acb92a6-fc5f-4dfc-9b9b-e4d22190b5ca',
  'bfd5b103-678a-40b3-afc3-c4d9bdf33f4e',
  'f68c78be-f95a-4f39-86df-4ce38456153b',
  'adaf3a09-45d2-43ae-a21e-8ccbf8aed551',
  '937da04d-6374-40a4-9b55-c8ae75797487',
  '965fb4a5-e2e5-4e66-8762-de69aa1c827f',
  '71f9c83a-1c2b-4bc0-b64b-825fbf9a2767',
  '16245f3c-e508-48f4-b73c-149935ff75f6',
  'b2d7b2cc-9373-45df-a571-f8fe5f732fc8',
  'c0255714-e104-42a1-9591-b0511a5b3821',
  'fc8ef765-84db-41f3-bc68-44fba96e222c',
  'af5bea73-c368-44a9-9d2c-6582496086fc',
  '7dd2b23e-5e7e-4450-9dc1-c854af229a7b',
  '52db6469-0035-4852-a07b-95ba25e4a6de',
  '1ccff4bf-f9db-43bf-bd0e-6791911b0dd3'
);
