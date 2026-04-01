-- Квартиры в приложении хранятся в public.units (таблица apartments в ТЗ = эта таблица).
-- Выполнить в Supabase SQL Editor.

alter table public.units
  add column if not exists number integer;

-- position — зарезервированное слово в SQL, имя колонки в кавычках
alter table public.units
  add column if not exists "position" integer;

comment on column public.units.number is 'Номер квартиры (если задан — показывается в шахматке)';
comment on column public.units."position" is 'Порядковый номер на этаже (если number не задан)';
