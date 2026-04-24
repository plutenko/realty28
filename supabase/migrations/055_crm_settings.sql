-- Настройки CRM-модуля (singleton). Для MVP — toggle лимита активных
-- лидов на риелтора и значение порога. В будущем сюда же можно добавлять
-- SLA-тайминги, настройки эскалации и т.п.
CREATE TABLE IF NOT EXISTS crm_settings (
  id int PRIMARY KEY DEFAULT 1,
  limits_enabled boolean NOT NULL DEFAULT false,
  limit_threshold int NOT NULL DEFAULT 10,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_settings_singleton CHECK (id = 1)
);

INSERT INTO crm_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE crm_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only crm_settings" ON crm_settings;
CREATE POLICY "Service role only crm_settings" ON crm_settings
  FOR ALL USING (auth.role() = 'service_role');
