-- Количество квартир на этаже для ровной шахматки
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS units_per_floor int NOT NULL DEFAULT 4;

