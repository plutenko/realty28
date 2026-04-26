-- Предпочитаемый мессенджер клиента (max | whatsapp | telegram | viber | ...).
-- Марквиз отдаёт в payload.extra.messenger; квизы спрашивают это перед телефоном,
-- риелтор должен знать куда писать.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS messenger text;
CREATE INDEX IF NOT EXISTS idx_leads_messenger ON leads(messenger) WHERE messenger IS NOT NULL;
