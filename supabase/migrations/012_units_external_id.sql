-- Поддержка внешнего id для upsert из Profitbase
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS external_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'units_external_id_key'
  ) THEN
    ALTER TABLE public.units
      ADD CONSTRAINT units_external_id_key UNIQUE (external_id);
  END IF;
END $$;

