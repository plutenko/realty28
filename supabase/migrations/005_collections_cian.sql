-- Подборки квартир уровня маркетплейса
-- Приведение legacy-структуры к модели:
-- collections(units uuid[], client_name, views_count) + collection_views

ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS units uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS views_count int NOT NULL DEFAULT 0;

-- Если была таблица связей collection_units — переносим в массив collections.units
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'collection_units'
  ) THEN
    UPDATE public.collections c
    SET units = COALESCE((
      SELECT array_agg(cu.unit_id ORDER BY cu.sort_order ASC)
      FROM public.collection_units cu
      WHERE cu.collection_id = c.id
    ), '{}')
    WHERE COALESCE(array_length(c.units, 1), 0) = 0;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.collection_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  user_agent text
);

CREATE INDEX IF NOT EXISTS idx_collection_views_collection
  ON public.collection_views (collection_id);

ALTER TABLE public.collection_views ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'collection_views' AND policyname = 'read_collection_views'
  ) THEN
    CREATE POLICY "read_collection_views" ON public.collection_views FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'collection_views' AND policyname = 'write_collection_views'
  ) THEN
    CREATE POLICY "write_collection_views" ON public.collection_views FOR INSERT WITH CHECK (true);
  END IF;
END $$;

