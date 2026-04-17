-- Правила окна приёма отчётов и ширина диапазона.
-- Окно за день D: [D 12:00 local, (D+1) summary_time local). После summary_time сводка сформирована.
-- Диапазон > 1 день разрешён только по выходным (Пт+Сб+Вс).

UPDATE reports_settings
SET settings = settings
    - 'max_days_back'
    || jsonb_build_object(
      'report_window_open', '12:00',
      'max_range_days', 3,
      'range_allowed_days', jsonb_build_array(5, 6, 0)  -- JS Date.getUTCDay: Пт=5, Сб=6, Вс=0
    )
    || jsonb_build_object(
      'messages',
      (settings -> 'messages')
        - 'error_too_old'
        || jsonb_build_object(
          'error_too_old', '🤔 {name}, сводка за {value} уже сформирована. Окно было до {close_at}.',
          'error_too_early', '🤔 {name}, отчёт за {value} можно прислать только начиная с {open_at}.',
          'error_range_too_wide', '🤔 {name}, диапазон {value} = {actual_days} дн, максимум {max_days}.',
          'error_range_not_weekend', '🤔 {name}, диапазон можно только за выходные (Пт-Вс). В будни присылай отдельное сообщение на каждый день.'
        )
    ),
    updated_at = now()
WHERE id = 1;
