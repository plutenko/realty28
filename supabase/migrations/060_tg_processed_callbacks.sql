-- 060_tg_processed_callbacks.sql
-- Идемпотентность для Telegram callback_query: если webhook ретрайнул тот же
-- cq.id (например при таймауте handler'а), второй заход видит запись и тихо
-- выходит, не дублируя побочки (edit чужих сообщений, notify менеджеров и т.п.).
-- Инцидент 27.04.2026 (лид Михаил +79145584475): двойной webhook затёр
-- winner-card Верховцевой fallback-сообщением.

CREATE TABLE IF NOT EXISTS tg_processed_callbacks (
  cq_id text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Индекс для периодической очистки старых записей.
CREATE INDEX IF NOT EXISTS idx_tg_processed_callbacks_processed_at
  ON tg_processed_callbacks (processed_at);
