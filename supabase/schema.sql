-- Enable UUID extension
create extension if not exists "pgcrypto";

-- Cases table
create table if not exists cases (
  id uuid primary key default gen_random_uuid(),
  case_ref text unique not null,
  created_at timestamptz default now(),
  client_name text,
  status text default 'pending_extraction',
  file_count integer default 0,
  pass_count integer default 0,
  fail_count integer default 0,
  warn_count integer default 0,
  overall_result text default 'pending'
);

-- Documents table
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id) on delete cascade,
  file_name text,
  file_type text,
  storage_path text,
  created_at timestamptz default now()
);

-- Extracted fields table
create table if not exists extracted_fields (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id) on delete cascade,
  doc_type text,
  field_name text,
  field_value text,
  confidence text default 'high',
  created_at timestamptz default now()
);

-- Verification results table
create table if not exists verification_results (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id) on delete cascade,
  category text,
  check_name text,
  expected_value text,
  found_value text,
  status text,
  note text,
  created_at timestamptz default now()
);

-- Storage bucket (run in Supabase dashboard or via CLI)
-- insert into storage.buckets (id, name, public) values ('trade-documents', 'trade-documents', false);

-- RLS policies (permissive for dev - tighten in production)
alter table cases enable row level security;
alter table documents enable row level security;
alter table extracted_fields enable row level security;
alter table verification_results enable row level security;

create policy "Allow all for anon" on cases for all using (true) with check (true);
create policy "Allow all for anon" on documents for all using (true) with check (true);
create policy "Allow all for anon" on extracted_fields for all using (true) with check (true);
create policy "Allow all for anon" on verification_results for all using (true) with check (true);
