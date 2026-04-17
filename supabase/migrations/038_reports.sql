-- Ежедневные отчёты риелторов через Telegram-бот @sobr_reports_bot
-- Бот наблюдает в общем чате, парсит сообщения формата "Отчёт DD.MM" с 14 метриками.

-- ============================================================================
-- profiles: кто отчёты присылает и Telegram user_id (отдельно от chat_id логин-бота)
-- ============================================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_user_id text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS submits_reports boolean NOT NULL DEFAULT false;

-- У админа/менеджера уже есть telegram_chat_id от логин-бота. В ЛС chat_id == user_id — копируем.
UPDATE profiles
SET telegram_user_id = telegram_chat_id
WHERE telegram_user_id IS NULL AND telegram_chat_id IS NOT NULL;

-- Дефолт: риелторы отчёты присылают, остальные — нет.
UPDATE profiles SET submits_reports = true WHERE role = 'realtor';

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_telegram_user_id
  ON profiles(telegram_user_id) WHERE telegram_user_id IS NOT NULL;

-- ============================================================================
-- telegram_chat_members: все, кто пишет в чате отчётов (для связки в админке)
-- ============================================================================
CREATE TABLE IF NOT EXISTS telegram_chat_members (
  telegram_user_id text PRIMARY KEY,
  username text,
  first_name text,
  last_name text,
  is_ignored boolean NOT NULL DEFAULT false,  -- директор и посторонние
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- daily_reports: сами отчёты, 14 метрик + диапазон дат + трекинг сообщений бота
-- ============================================================================
CREATE TABLE IF NOT EXISTS daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date_from date NOT NULL,
  date_to date NOT NULL,

  -- трекинг сообщений в Telegram (для реакций и удаления реплая об ошибке при правке)
  chat_id bigint NOT NULL,
  chat_message_id bigint NOT NULL,
  error_reply_message_id bigint,
  is_valid boolean NOT NULL DEFAULT true,

  raw_text text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- 14 метрик (плюс raw для сложных "показов")
  cold_calls integer,                     -- Хз (холодные звонки)
  leaflet integer,                        -- Расклейка
  activations integer,                    -- Активации
  meetings integer,                       -- Встречи
  consultations integer,                  -- Консультации
  repeat_touch integer,                   -- Повт касание
  shows_objects_count integer,            -- Показы (об) — кол-во показов
  shows_objects_objects integer,          -- Показы (об) — кол-во уникальных объектов
  shows_objects_raw text,                 -- исходник типа "1(1) 1(2)"
  shows_clients_count integer,            -- Показы (пок)
  shows_clients_raw text,
  ad_exclusive integer,                   -- АД (экс)
  ad_search integer,                      -- АД (поиск)
  new_buildings_presentations integer,    -- През.новостроек
  deposits bigint,                        -- Авансы (в рублях)
  revenue bigint,                         -- Вал (в рублях)
  selection integer,                      -- Подбор

  extra jsonb NOT NULL DEFAULT '{}'::jsonb,  -- непредвиденные поля вроде "Баннер 1"

  CONSTRAINT daily_reports_date_range_check CHECK (date_to >= date_from)
);

-- Один отчёт на (user, конкретный период). Повторная отправка с теми же датами — перезапись.
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_reports_user_range
  ON daily_reports(user_id, date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_daily_reports_dates ON daily_reports(date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_daily_reports_user ON daily_reports(user_id);

-- ============================================================================
-- reports_settings: все настройки одним jsonb singleton'ом (id=1)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reports_settings (
  id int PRIMARY KEY DEFAULT 1,
  settings jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reports_settings_singleton CHECK (id = 1)
);

INSERT INTO reports_settings (id, settings) VALUES (1, '{
  "timezone": "Asia/Yakutsk",
  "reminder_time": "20:00",
  "deadline_time": "09:00",
  "summary_time": "09:30",
  "ask_days": ["mon","tue","wed","thu","sun"],
  "sunday_batch_days": 3,
  "weekend_summary_mode": "aggregated",
  "holidays": [],
  "report_marker_words": ["Отчёт","Отчет","отчет","отчёт","ОТЧЕТ","ОТЧЁТ"],
  "min_label_matches_without_marker": 7,
  "max_days_back": 7,
  "mention_mode": "username_with_fallback",
  "reaction_accepted": "👌",
  "reaction_rejected": "🤔",
  "metrics": [
    {"key":"cold_calls","label":"Хз","aliases":["Хз","Холодные звонки"],"type":"int","show_in_summary":false,"order":1},
    {"key":"leaflet","label":"Расклейка","aliases":["Расклейка"],"type":"int","show_in_summary":false,"order":2},
    {"key":"activations","label":"Активации","aliases":["Активации"],"type":"int","show_in_summary":true,"order":3},
    {"key":"meetings","label":"Встречи","aliases":["Встречи"],"type":"int","show_in_summary":true,"order":4},
    {"key":"consultations","label":"Консультации","aliases":["Консультации"],"type":"int","show_in_summary":true,"order":5},
    {"key":"repeat_touch","label":"Повт касание","aliases":["Повт касание","Повторное касание"],"type":"int","show_in_summary":false,"order":6},
    {"key":"shows_objects","label":"Показы (об)","aliases":["Показы (об)","Показы объектов"],"type":"shows","show_in_summary":true,"order":7},
    {"key":"shows_clients","label":"Показы (пок)","aliases":["Показы (пок)","Показы покупателей"],"type":"shows","show_in_summary":true,"order":8},
    {"key":"ad_exclusive","label":"АД (экс)","aliases":["АД (экс)","АД экс"],"type":"int","show_in_summary":true,"order":9},
    {"key":"ad_search","label":"АД (поиск)","aliases":["АД (поиск)","АД поиск"],"type":"int","show_in_summary":true,"order":10},
    {"key":"new_buildings_presentations","label":"През.новостроек","aliases":["През.новостроек","Презентации новостроек"],"type":"int","show_in_summary":true,"order":11},
    {"key":"deposits","label":"Авансы","aliases":["Авансы"],"type":"money","show_in_summary":true,"order":12},
    {"key":"revenue","label":"Вал","aliases":["Вал","Валовая выручка"],"type":"money","show_in_summary":true,"order":13},
    {"key":"selection","label":"Подбор","aliases":["Подбор"],"type":"int","show_in_summary":false,"order":14}
  ],
  "messages": {
    "reminder_weekday": "⏰ Напоминание! Ждём отчёты за {date}. Не прислали: {users}",
    "reminder_sunday_batch": "⏰ Напоминание! Ждём отчёты за {dates}. Не прислали: {users}",
    "summary_header_day": "📊 Сводка за {date}\nОтчитались: {submitted_count} из {total_count}",
    "summary_header_range": "📊 Сводка за {date_from} – {date_to}\nОтчитались: {submitted_count} из {total_count}",
    "summary_missing": "Не прислали: {users}",
    "error_no_date": "🤔 {name}, укажи за какой период отчёт.\n\nПримеры:\n• Отчёт 17.04 — за один день\n• Отчёт 17-19.04 — за диапазон\n• Отчёт с 17.04 по 19.04 — за диапазон\n\nМожно без года — подставлю текущий.",
    "error_bad_date": "🤔 {name}, не могу разобрать дату «{value}».\nФормат: Отчёт DD.MM (например: Отчёт 17.04)",
    "error_future": "🤔 {name}, дата {value} в будущем. Проверь — возможно опечатка.",
    "error_too_old": "🤔 {name}, дата {value} старше {days} дней. Если не ошибка — напиши админу.",
    "error_range_inverted": "🤔 {name}, диапазон {value} — конец раньше начала. Проверь.",
    "admin_unknown_user": "В чате отчётов новый автор: {name} (tg id {id}).\nПривяжи на /admin/reports/bindings"
  }
}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE telegram_chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only telegram_chat_members" ON telegram_chat_members
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role only daily_reports" ON daily_reports
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role only reports_settings" ON reports_settings
  FOR ALL USING (auth.role() = 'service_role');
