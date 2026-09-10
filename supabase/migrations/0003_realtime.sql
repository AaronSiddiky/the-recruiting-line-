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
