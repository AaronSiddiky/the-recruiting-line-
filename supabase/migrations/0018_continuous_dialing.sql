-- RecruitingLine :: continuous dialing. Safe to run repeatedly.
--
-- Lines are topped up one at a time as they finish, so legs from several
-- batches ring at once. "First to answer wins" therefore moves from the batch
-- to the session: call_sessions.live_call_id is the single slot, claimed with
-- an atomic compare-and-set. The slot frees itself when that call has an
-- ended_at, so nothing has to remember to release it.

alter table call_sessions add column if not exists live_call_id uuid references calls(id) on delete set null;

create or replace function public.claim_batch_winner(p_batch_id uuid, p_call_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_session uuid;
  won boolean;
begin
  select session_id into v_session from dial_batches where id = p_batch_id;
  if v_session is null then
    return false;
  end if;

  -- Atomic: only one of two simultaneous answers can flip the slot.
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
