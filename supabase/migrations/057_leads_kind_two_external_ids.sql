-- Категория лида и поддержка двух ID в базе агентства, если клиент одновременно
-- продаёт свою квартиру и покупает новую (lead_kind='both').
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS lead_kind text;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS external_base_id_seller text;

COMMENT ON COLUMN leads.lead_kind IS 'buyer | seller | both — категория клиента';
COMMENT ON COLUMN leads.external_base_id IS 'ID в базе агентства (если both — покупательская сторона)';
COMMENT ON COLUMN leads.external_base_id_seller IS 'ID продавца в базе агентства (только когда lead_kind=both)';

CREATE INDEX IF NOT EXISTS idx_leads_lead_kind ON leads(lead_kind) WHERE lead_kind IS NOT NULL;
