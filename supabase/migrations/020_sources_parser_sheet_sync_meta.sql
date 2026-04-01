-- Parser kind, sheet tab name, sync stats for sources (Google Sheets шахматка и др.)

ALTER TABLE public.sources
  ADD COLUMN IF NOT EXISTS parser_type text,
  ADD COLUMN IF NOT EXISTS sheet_name text,
  ADD COLUMN IF NOT EXISTS last_sync_count integer,
  ADD COLUMN IF NOT EXISTS last_sync_error text;

-- Тип profitbase для уже существующих PB-источников (parser_type в UI).
UPDATE public.sources
SET parser_type = 'profitbase'
WHERE parser_type IS NULL
  AND type = 'profitbase';
