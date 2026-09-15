-- RecruitingLine :: Spotify connection per rep. Safe to run repeatedly.
--
-- Tokens are only ever read and written by the server with the service key;
-- RLS is on with no policies so the browser can never see them.

create table if not exists spotify_tokens (
  user_id       uuid primary key references profiles(id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  scope         text,
  display_name  text,
  updated_at    timestamptz not null default now()
);

alter table spotify_tokens enable row level security;

-- Make the new table visible to the API immediately.
notify pgrst, 'reload schema';
