-- 028: роль manager + привязка подборок к риелтору

-- Добавить роль manager
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'realtor', 'manager'));

-- Добавить поле created_by в collections (uuid пользователя-риелтора)
alter table public.collections
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- Индекс для быстрого поиска подборок по риелтору
create index if not exists idx_collections_created_by
  on public.collections (created_by);
