-- Очередь для setMessageReaction, которые не прошли с первой попытки.
-- Причина: контейнер Timeweb регулярно теряет коннекты к api.telegram.org
-- (Connect Timeout), из-за чего реакции на отчёты не ставились. Webhook
-- сохраняет отчёт в БД и пытается поставить реакцию inline; при неудаче —
-- пишет сюда. Крон-воркер `/api/reports/retry-reactions` раз в минуту
-- достаёт строки с `next_try_at <= now()` и ретраит, с экспоненциальным
-- бэк-оффом. После 10 безуспешных попыток запись остаётся для ручного
-- разбора.
CREATE TABLE IF NOT EXISTS pending_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  message_id bigint NOT NULL,
  emoji text NOT NULL DEFAULT '👌',
  attempts int NOT NULL DEFAULT 0,
  next_try_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS pending_reactions_next_try_idx
  ON pending_reactions (next_try_at)
  WHERE attempts < 10;
