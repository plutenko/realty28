# Supabase Storage для фото

1. Создайте bucket **`images`** (public).
2. Policies → разрешите `INSERT`, `SELECT` для роли `anon` (или только `authenticated` в проде).

Записи в таблице `public.images`: `entity_type` = `developer` | `complex` | …, `entity_id` = UUID сущности. Обложки ЖК для `/buildings` загружаются в админке **ЖК** (`/admin/complexes`) при редактировании ЖК.

Пример SQL (выполните в SQL Editor при необходимости):

```sql
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;
```
