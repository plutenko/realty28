-- Developers (застройщики)
create table if not exists public.developers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_description text,
  website text,
  phone text,
  created_at timestamptz not null default now()
);

-- Projects (ЖК)
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid references public.developers(id) on delete set null,
  slug text unique,
  name text not null,
  city text,
  district text,
  address text,
  delivery_quarter text,
  delivery_year int,
  hero_image_url text, -- главное фото ЖК
  created_at timestamptz not null default now()
);

-- Buildings (корпуса/дома) - опционально
create table if not exists public.buildings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text,
  floors int,
  created_at timestamptz not null default now()
);

-- Связи для units
alter table public.units
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists building_id uuid references public.buildings(id) on delete set null;

alter table public.units
  add column if not exists number integer;

alter table public.units
  add column if not exists "position" integer;

-- RLS (простое публичное чтение ЖК)
alter table public.developers enable row level security;
alter table public.projects enable row level security;
alter table public.buildings enable row level security;

drop policy if exists "public read developers" on public.developers;
create policy "public read developers" on public.developers
for select using (true);

drop policy if exists "public read projects" on public.projects;
create policy "public read projects" on public.projects
for select using (true);

drop policy if exists "public read buildings" on public.buildings;
create policy "public read buildings" on public.buildings
for select using (true);

-- Представление ЖК для API: .from('complexes')
create or replace view public.complexes as
select * from public.projects;

grant select on public.complexes to anon, authenticated;

