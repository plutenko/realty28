-- ЖК в приложении = public.projects.
-- Представление complexes для запросов вида .from('complexes')
-- Выполнить в Supabase SQL Editor.

create or replace view public.complexes as
select * from public.projects;

comment on view public.complexes is 'Алиас таблицы projects (жилые комплексы)';

grant select on public.complexes to anon, authenticated;
