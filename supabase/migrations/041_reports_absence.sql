-- Поддержка отметок отсутствия вместо отчёта (выходной, отпуск, отгул, больничный).
-- Риелтор пишет "Выходной" / "Отпуск 14-21.04" / "Больничный" — бот ставит 👌,
-- метрики не заполняются, в сводке/напоминалках этот человек идёт отдельной строкой
-- "отсутствуют", а не "не прислали".

ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS absence_type text;

-- absence_markers: слово-триггер → тип отсутствия (day_off | vacation | sick_leave | ...).
UPDATE reports_settings
SET settings = settings || jsonb_build_object(
      'absence_markers', jsonb_build_object(
        'выходной', 'day_off',
        'отгул', 'day_off',
        'отпуск', 'vacation',
        'больничный', 'sick_leave'
      )
    ),
    updated_at = now()
WHERE id = 1;
