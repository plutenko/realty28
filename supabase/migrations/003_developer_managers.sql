-- Менеджеры застройщика (несколько на одного developer)
-- Выполните в Supabase SQL Editor после бэкапа.

CREATE TABLE IF NOT EXISTS public.developer_managers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id uuid NOT NULL REFERENCES public.developers (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  phone text,
  short_description text,
  messenger text NOT NULL DEFAULT 'telegram',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT developer_managers_messenger_check
    CHECK (messenger IN ('whatsapp', 'telegram', 'max'))
);

CREATE INDEX IF NOT EXISTS idx_developer_managers_developer
  ON public.developer_managers (developer_id);

ALTER TABLE public.developer_managers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'developer_managers' AND policyname = 'read_developer_managers'
  ) THEN
    CREATE POLICY "read_developer_managers" ON public.developer_managers FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'developer_managers' AND policyname = 'write_developer_managers'
  ) THEN
    CREATE POLICY "write_developer_managers" ON public.developer_managers FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
