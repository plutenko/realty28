-- Разрешаем тип источника amurstroy (Bitrix project-layouts на as-dv.ru).
-- Попутно синхронизируем constraint с актуальным SOURCE_TYPES из UI:
-- пред. миграция 037 отставала от реальных типов (fsk, pik, google_sheets).
ALTER TABLE public.sources DROP CONSTRAINT IF EXISTS sources_type_check;
ALTER TABLE public.sources
  ADD CONSTRAINT sources_type_check
  CHECK (type IN (
    'google',
    'google_sheets',
    'csv',
    'api',
    'profitbase',
    'macrocrm',
    'fsk',
    'pik',
    'amurstroy'
  ));
