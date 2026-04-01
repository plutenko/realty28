-- Добавляет модель комиссии риелтора на уровне ЖК.
-- Выполните после 001_newbuildings.sql.

ALTER TABLE public.complexes
  ADD COLUMN IF NOT EXISTS realtor_commission_type text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS realtor_commission_value numeric;

DO $$
BEGIN
  -- Ограничиваем типы комиссии допустимыми значениями.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'complexes_realtor_commission_type_check'
  ) THEN
    ALTER TABLE public.complexes
      ADD CONSTRAINT complexes_realtor_commission_type_check
      CHECK (realtor_commission_type IN ('none', 'percent', 'fixed_rub', 'rub_per_m2'));
  END IF;
END $$;

