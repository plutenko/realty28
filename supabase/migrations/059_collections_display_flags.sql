-- 059_collections_display_flags.sql
-- Тумблеры видимости информации в подборке для клиента.
-- Применено вручную через Supabase SQL Editor 2026-04-27.

ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS show_complex_name boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_developer_name boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_address boolean NOT NULL DEFAULT true;
