-- RecruitingLine :: pre-recorded voicemail drop. Safe to run repeatedly.
--
-- Each rep records one message. During a live call that turns out to be a
-- voicemail, "Leave voicemail" plays that message into the prospect's leg and
-- hangs it up, freeing the rep at once. The file lives in a private bucket
-- and is handed to Twilio through a short-lived signed URL.

alter table profiles add column if not exists voicemail_path text;
alter table calls add column if not exists voicemail_left_at timestamptz;

insert into storage.buckets (id, name, public)
values ('voicemails', 'voicemails', false)
on conflict (id) do nothing;

drop policy if exists voicemails_read on storage.objects;
create policy voicemails_read on storage.objects
  for select to authenticated
  using (bucket_id = 'voicemails');
