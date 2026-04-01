-- Гарантируем ON DELETE CASCADE для sources.building_id
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT c.conname
  INTO fk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'sources'
    AND c.contype = 'f'
    AND EXISTS (
      SELECT 1
      FROM pg_attribute a
      WHERE a.attrelid = t.oid
        AND a.attnum = ANY (c.conkey)
        AND a.attname = 'building_id'
    )
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.sources DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE public.sources
  ADD CONSTRAINT sources_building_id_fkey
  FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;

