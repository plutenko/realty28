ALTER TABLE public.buildings
ADD COLUMN IF NOT EXISTS handover_status text;

ALTER TABLE public.buildings
ADD COLUMN IF NOT EXISTS handover_quarter smallint;

ALTER TABLE public.buildings
ADD COLUMN IF NOT EXISTS handover_year integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'buildings_handover_status_check'
  ) THEN
    ALTER TABLE public.buildings
      ADD CONSTRAINT buildings_handover_status_check
      CHECK (handover_status IS NULL OR handover_status IN ('planned', 'delivered'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'buildings_handover_quarter_check'
  ) THEN
    ALTER TABLE public.buildings
      ADD CONSTRAINT buildings_handover_quarter_check
      CHECK (handover_quarter IS NULL OR handover_quarter BETWEEN 1 AND 4);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'buildings_handover_year_check'
  ) THEN
    ALTER TABLE public.buildings
      ADD CONSTRAINT buildings_handover_year_check
      CHECK (handover_year IS NULL OR handover_year BETWEEN 2000 AND 2100);
  END IF;
END $$;

