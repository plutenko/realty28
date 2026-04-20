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

-- Партиальный уникальный индекс: только строки с external_id.
CREATE UNIQUE INDEX IF NOT EXISTS units_source_external_id_key
  ON public.units (source_id, external_id)
  WHERE external_id IS NOT NULL;
