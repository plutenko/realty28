-- Привязка источника к конкретному дому
ALTER TABLE public.sources
  ADD COLUMN IF NOT EXISTS building_id uuid REFERENCES public.buildings (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sources_building_id
  ON public.sources (building_id);

