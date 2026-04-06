-- Per-source Profitbase settings (different developers may have different accounts)
ALTER TABLE sources ADD COLUMN IF NOT EXISTS pb_account_id text;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS pb_referer text;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS pb_api_key text;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS pb_domain text DEFAULT 'profitbase.ru';
