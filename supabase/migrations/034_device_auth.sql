-- Device-based auth for realtors: binding + approval flow via Telegram

-- Telegram chat_id для админов/менеджеров (для отправки уведомлений)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_chat_id text;
-- Одноразовый код для привязки Telegram к аккаунту
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_link_code text;

-- Зарегистрированные устройства пользователя
CREATE TABLE IF NOT EXISTS user_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_hash text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_hash)
);
CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices(user_id);

-- Ожидающие подтверждения входы с новых устройств
CREATE TABLE IF NOT EXISTS pending_logins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_hash text NOT NULL,
  device_label text,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected | expired
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_pending_logins_token ON pending_logins(token);
CREATE INDEX IF NOT EXISTS idx_pending_logins_user ON pending_logins(user_id, status);

ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_logins ENABLE ROW LEVEL SECURITY;

-- Служебные таблицы только для service_role
CREATE POLICY "Service role only user_devices" ON user_devices FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role only pending_logins" ON pending_logins FOR ALL USING (auth.role() = 'service_role');
