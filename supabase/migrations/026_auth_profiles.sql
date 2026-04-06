-- 026: таблица профилей с ролью (admin / realtor)
-- Создаётся вручную через Supabase Dashboard или Admin API

create table if not exists public.profiles (
  id      uuid references auth.users on delete cascade primary key,
  role    text not null check (role in ('admin', 'realtor')),
  name    text,
  email   text,
  created_at timestamptz default now() not null
);

alter table public.profiles enable row level security;

-- Пользователь читает только свой профиль
create policy "profiles: own read"
  on public.profiles for select
  using (auth.uid() = id);

-- Service-role имеет полный доступ (для сервера)
create policy "profiles: service role all"
  on public.profiles
  using (auth.role() = 'service_role');
