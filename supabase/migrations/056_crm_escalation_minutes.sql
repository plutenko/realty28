-- Настраиваемый порог автоэскалации невзятых лидов (в минутах).
-- Default 40. Крон /api/leads/cron/escalate-unclaimed читает это значение.
ALTER TABLE crm_settings
  ADD COLUMN IF NOT EXISTS unclaimed_escalation_minutes int NOT NULL DEFAULT 40;
