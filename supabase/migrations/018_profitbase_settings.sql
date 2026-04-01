-- Глобальные настройки Profitbase (чтобы не править .env.local вручную).

CREATE TABLE IF NOT EXISTS public.profitbase_settings (
  id integer PRIMARY KEY DEFAULT 1,
  account_id text,
  site_widget_referer text,
  pb_api_key text,
  pb_domain text NOT NULL DEFAULT 'profitbase.ru',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Одна строка (id=1)
INSERT INTO public.profitbase_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.profitbase_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_profitbase_settings" ON public.profitbase_settings;
DROP POLICY IF EXISTS "write_profitbase_settings" ON public.profitbase_settings;

-- MVP: доступ как и остальная админка (anon full access)
CREATE POLICY "read_profitbase_settings" ON public.profitbase_settings FOR SELECT USING (true);
CREATE POLICY "write_profitbase_settings" ON public.profitbase_settings FOR ALL USING (true) WITH CHECK (true);

