-- ID лида в базе агентства (ручной ввод админом при подтверждении add_to_base → in_work).
-- Позволяет связать нашу запись с внешней CRM/базой для сквозного трекинга.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS external_base_id text;

CREATE INDEX IF NOT EXISTS idx_leads_external_base_id
  ON leads(external_base_id) WHERE external_base_id IS NOT NULL;
