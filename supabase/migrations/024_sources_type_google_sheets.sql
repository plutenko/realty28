-- Тип источника: google → google_sheets (шахматка) или csv (публикуемый текст).
-- Парсер шахматки: google_sheets / manual / *_oauth → sodruzhestvo; sodruzhestvo/default сохраняются.

UPDATE public.sources
SET
  type = 'google_sheets',
  parser_type = CASE
    WHEN parser_type IN ('google_sheets', 'manual', 'google_sheets_oauth') THEN 'sodruzhestvo'
    WHEN parser_type IN ('sodruzhestvo', 'default') THEN parser_type
    ELSE 'default'
  END
WHERE type = 'google'
  AND parser_type IS NOT NULL
  AND parser_type <> 'csv';

UPDATE public.sources
SET type = 'csv',
    parser_type = 'csv'
WHERE type = 'google';

UPDATE public.sources
SET type = 'csv'
WHERE type = 'api';
