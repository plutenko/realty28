-- Хранит ID активной сессии для каждого пользователя
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_session_id text;

-- Журнал входов
CREATE TABLE IF NOT EXISTS login_logs (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id   text NOT NULL,
  ip_address   text,
  browser      text,
  os_name      text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_logs_user_id_idx   ON login_logs(user_id);
CREATE INDEX IF NOT EXISTS login_logs_created_at_idx ON login_logs(created_at DESC);

-- RLS: только сервисная роль пишет/читает через API
ALTER TABLE login_logs ENABLE ROW LEVEL SECURITY;
