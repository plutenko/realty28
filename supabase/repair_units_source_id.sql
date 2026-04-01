-- Исправление: "Could not find the 'source_id' column of 'units' in the schema cache"
-- Выполните в Supabase → SQL Editor → Run.
--
-- Нужна таблица public.sources. Если её ещё нет — сначала выполните целиком:
--   supabase/migrations/007_sources_sync.sql
-- (и при необходимости 008_sources_building_id.sql, 011_sources_profitbase_type.sql).

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.sources (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_units_source_id ON public.units (source_id);

-- Для синка Profitbase также должны быть (если миграции 010–012 не гонялись):
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS external_id text;

-- Обязательно для upsert из import-units / Profitbase:
-- иначе: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'units_building_id_number_key'
  ) THEN
    ALTER TABLE public.units
      ADD CONSTRAINT units_building_id_number_key UNIQUE (building_id, number);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'units_external_id_key'
  ) THEN
    ALTER TABLE public.units
      ADD CONSTRAINT units_external_id_key UNIQUE (external_id);
  END IF;
END $$;

-- Если ADD CONSTRAINT упадёт из‑за дублей в данных, сначала найдите и разберите дубли:
-- SELECT external_id, count(*) FROM public.units WHERE external_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- SELECT building_id, number, count(*) FROM public.units GROUP BY 1,2 HAVING count(*) > 1;

-- Объединение ячеек в админ-шахматке (см. migrations/015_units_grid_span.sql):
-- ALTER TABLE public.units ADD COLUMN IF NOT EXISTS span_columns integer NOT NULL DEFAULT 1;
-- ALTER TABLE public.units ADD COLUMN IF NOT EXISTS span_floors integer NOT NULL DEFAULT 1;

-- Поэтажные планы в images (migrations/016_images_floor_level.sql):
-- ALTER TABLE public.images ADD COLUMN IF NOT EXISTS floor_level integer NULL;

-- После правок схемы в SQL Editor снова:
-- NOTIFY pgrst, 'reload schema';
