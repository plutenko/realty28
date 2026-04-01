-- Шахматка: подъезд/объединённые квартиры.
-- entrance: номер подъезда (1..N)
-- is_combined: квартира является результатом объединения нескольких
-- combined_unit_ids: какие квартиры были объединены в эту (uuid[]), для истории/аудита

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS entrance integer NULL,
  ADD COLUMN IF NOT EXISTS is_combined boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS combined_unit_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.units DROP CONSTRAINT IF EXISTS units_entrance_check;
ALTER TABLE public.units
  ADD CONSTRAINT units_entrance_check CHECK (entrance IS NULL OR entrance >= 1);

CREATE INDEX IF NOT EXISTS idx_units_building_entrance_floor
  ON public.units (building_id, entrance, floor);

