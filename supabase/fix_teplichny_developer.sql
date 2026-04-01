-- Опционально: привязать ЖК «Тепличный» к застройщику «Мегатек-Строй» (проверьте id в своей БД).
-- Выполните вручную после проверки имён в таблицах developers и projects.

-- Пример (раскомментируйте и подставьте uuid):
-- update public.projects p
-- set developer_id = (select id from public.developers d where trim(d.name) ilike 'мегатек-строй' limit 1)
-- where trim(p.name) ilike '%теплич%';
