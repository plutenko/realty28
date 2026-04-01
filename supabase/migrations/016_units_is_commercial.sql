-- Коммерческие помещения (синхрон из Google Sheets и т.п.)
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS is_commercial boolean NOT NULL DEFAULT false;
