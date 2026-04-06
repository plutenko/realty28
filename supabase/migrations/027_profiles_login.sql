-- 027: добавить колонку login в profiles (уникальный логин пользователя)
alter table public.profiles add column if not exists login text unique;
