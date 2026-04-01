# Новостройки — запуск

## 1. Миграция БД

В **Supabase → SQL Editor** выполните файл:

`supabase/migrations/001_newbuildings.sql`

Он удаляет старые таблицы (`projects`, старые `units`/`buildings` и т.д.) и создаёт:

`developers` → `complexes` → `buildings` → `units`, плюс `images`.

## 2. Storage

Создайте bucket **`images`** (public). См. `supabase/STORAGE_IMAGES.md`.

## 3. Переменные окружения

Скопируйте `.env.local.example` → `.env.local` и укажите:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 4. Код

- Загрузка данных: `lib/supabaseQueries.js` (`getDevelopers`, `getComplexes`, `getBuildings`, `getUnits`).
- Витрина: `/buildings`, `/apartments`.
- Админка: `/admin`, `/admin/developers`, `/admin/complexes`, `/admin/buildings`, `/admin/units`.

Связи только по **UUID**, без строковых `complexName` в БД.

## 5. Подборки (collections)

Миграция удаляет `collection_units`. Страница `/collections/[token]` потребует пересборки под новую схему или отключения.
