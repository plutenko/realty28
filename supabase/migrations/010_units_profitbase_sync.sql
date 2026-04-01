-- Поддержка upsert Profitbase и пометки "неактуальных" по времени
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'units_building_id_number_key'
  ) THEN
    ALTER TABLE public.units
      ADD CONSTRAINT units_building_id_number_key UNIQUE (building_id, number);
  END IF;
END $$;

