-- Защита от коллизий external_id между застройщиками.
-- Раньше было UNIQUE (external_id) — при повторяющемся id у двух источников
-- (MacroCRM Ленинграда и MacroCRM Клевера, Profitbase разных аккаунтов и т.д.)
-- синхронизация одного перезаписывала юниты другого.
--
-- Заменяем на UNIQUE (source_id, external_id). Для строк с external_id IS NULL
-- ограничение неактивно — такие строки (ручные) в upsert идут по building_id+number.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'units_external_id_key') THEN
    ALTER TABLE public.units DROP CONSTRAINT units_external_id_key;
  END IF;
END $$;

-- Используем обычный UNIQUE CONSTRAINT (а не partial index), потому что
-- PostgREST в on_conflict умеет только constraints, не partial indexes.
-- В PostgreSQL в UNIQUE два NULL-значения считаются различными, поэтому
-- строки с external_id IS NULL между собой не конфликтуют — ограничение
-- фактически работает как partial WHERE external_id IS NOT NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'units_source_external_id_key'
  ) THEN
    -- если от старой попытки остался partial index — удалим
    IF EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'units_source_external_id_key'
    ) THEN
      EXECUTE 'DROP INDEX public.units_source_external_id_key';
    END IF;
    ALTER TABLE public.units
      ADD CONSTRAINT units_source_external_id_key UNIQUE (source_id, external_id);
  END IF;
END $$;
