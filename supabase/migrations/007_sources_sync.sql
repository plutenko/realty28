-- Источники синхронизации шахматок
CREATE TABLE IF NOT EXISTS public.sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  type text NOT NULL DEFAULT 'csv',
  url text NOT NULL,
  developer_id uuid REFERENCES public.developers (id) ON DELETE SET NULL,
  last_sync_at timestamptz
);

ALTER TABLE public.sources
  DROP CONSTRAINT IF EXISTS sources_type_check;

ALTER TABLE public.sources
  ADD CONSTRAINT sources_type_check
  CHECK (type IN ('google', 'csv', 'api'));

CREATE INDEX IF NOT EXISTS idx_sources_developer_id
  ON public.sources (developer_id);

-- Привязка импортированных квартир к источнику, чтобы чистить перед новым импортом.
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.sources (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_units_source_id
  ON public.units (source_id);

ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sources' AND policyname = 'read_sources'
  ) THEN
    CREATE POLICY "read_sources" ON public.sources FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sources' AND policyname = 'write_sources'
  ) THEN
    CREATE POLICY "write_sources" ON public.sources FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

