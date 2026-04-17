-- Маппинг "исходное сообщение в чате → реплай бота с ошибкой".
-- Нужен чтобы при исправлении невалидного отчёта удалить предыдущий error-реплай.

CREATE TABLE IF NOT EXISTS report_error_replies (
  chat_id bigint NOT NULL,
  chat_message_id bigint NOT NULL,
  error_reply_message_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, chat_message_id)
);

ALTER TABLE report_error_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only report_error_replies" ON report_error_replies
  FOR ALL USING (auth.role() = 'service_role');
