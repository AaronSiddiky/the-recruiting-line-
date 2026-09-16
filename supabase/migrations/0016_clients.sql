-- RecruitingLine :: clients. Safe to run repeatedly.
--
-- A client is a company that signed. It keeps the contract terms, who won the
-- account, the contact, the signed contract file, and a log of touch points
-- (calls, emails, meetings) with the next follow-up. Shared by the team.

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references companies(id) on delete cascade,
  won_by uuid references profiles(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  contact_name text,
  contact_title text,
  contact_email text,
  contact_phone text,
  signed_at date,
  fee_cents integer,
  fee_note text,
  guarantee_days integer,
  payment_terms text,
  role_brief text,
  contract_path text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists client_touchpoints (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  at timestamptz not null default now(),
  channel text not null default 'call' check (channel in ('call', 'email', 'text', 'meeting', 'other')),
  summary text not null,
  next_follow_up date,
  created_at timestamptz not null default now()
);

create index if not exists client_touchpoints_client_idx on client_touchpoints (client_id, at desc);

drop trigger if exists clients_touch on clients;
create trigger clients_touch before update on clients
  for each row execute function public.touch_updated_at();

alter table clients enable row level security;
alter table client_touchpoints enable row level security;

drop policy if exists clients_all on clients;
create policy clients_all on clients
  for all to authenticated using (true) with check (true);
drop policy if exists client_touchpoints_all on client_touchpoints;
create policy client_touchpoints_all on client_touchpoints
  for all to authenticated using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('contracts', 'contracts', false)
on conflict (id) do nothing;

drop policy if exists contracts_read on storage.objects;
create policy contracts_read on storage.objects
  for select to authenticated
  using (bucket_id = 'contracts');

-- First client: Grand Canyon Home Services, signed Sep 14, 2026, won by Leonard.
insert into clients (company_id, won_by, contact_name, signed_at, fee_cents, fee_note, guarantee_days, payment_terms, role_brief, notes)
values (
  '784875e7-e7e4-4f3c-80d9-b1731d916da1',
  'd6602907-4394-483b-90d0-67def55598fa',
  'Jimmy LeForce',
  '2026-09-14',
  112000,
  'per technician hired; no search or interview fees',
  90,
  'Invoiced on the technician''s first day of work, due within 14 days.',
  'Install technician: repairs down units, changes compressors and TXVs, diagnoses systems, handles electrical, plumbing and refrigeration repair. Own tools. Open to commission-based pay.',
  'One replacement per hire inside the 90-day guarantee. Fee applies to any introduced candidate hired within 6 months. Either side may end with written notice; fees for technicians already hired still apply.'
)
on conflict (company_id) do nothing;

notify pgrst, 'reload schema';
