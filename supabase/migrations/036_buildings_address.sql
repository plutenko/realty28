-- Адрес корпуса — точный для сданных домов, пересечение улиц для строящихся.
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS address text;
