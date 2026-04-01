-- Schema for MVP: units + shareable collections
-- Run this in Supabase Dashboard -> SQL Editor.

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  project_name text,
  rooms int,
  area_m2 numeric,
  floor int,
  price_rub bigint,
  orientation text,
  layout_title text,
  layout_image_url text,
  finish_image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  title text,
  created_at timestamptz not null default now()
);

create table if not exists public.collection_units (
  collection_id uuid not null references public.collections(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  sort_order int not null default 0,
  primary key (collection_id, unit_id)
);

-- RLS (MVP публичного просмотра подборок)
alter table public.units enable row level security;
alter table public.collections enable row level security;
alter table public.collection_units enable row level security;

drop policy if exists "public read units" on public.units;
create policy "public read units" on public.units
for select using (true);

drop policy if exists "public read collections" on public.collections;
create policy "public read collections" on public.collections
for select using (true);

drop policy if exists "public read collection_units" on public.collection_units;
create policy "public read collection_units" on public.collection_units
for select using (true);

