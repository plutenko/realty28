-- =============================================================================
-- Новостройки: схема БД (developers → complexes → buildings → units)
-- Выполните в Supabase SQL Editor после бэкапа.
-- Удаляет старые таблицы с теми же именами (projects, старые buildings/units).
-- =============================================================================

DROP VIEW IF EXISTS public.complexes CASCADE;

DROP TABLE IF EXISTS public.collection_units CASCADE;
DROP TABLE IF EXISTS public.images CASCADE;
DROP TABLE IF EXISTS public.units CASCADE;
DROP TABLE IF EXISTS public.buildings CASCADE;
DROP TABLE IF EXISTS public.projects CASCADE;
DROP TABLE IF EXISTS public.complexes CASCADE;
DROP TABLE IF EXISTS public.developers CASCADE;

-- Подборки (если нужны — раскомментируйте и пересоздайте под новые units)
-- DROP TABLE IF EXISTS public.collections CASCADE;

CREATE TABLE public.developers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  short_description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.complexes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  developer_id uuid REFERENCES public.developers (id) ON DELETE SET NULL,
  city text,
  realtor_commission_type text NOT NULL DEFAULT 'none',
  realtor_commission_value numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  complex_id uuid REFERENCES public.complexes (id) ON DELETE CASCADE,
  floors integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid REFERENCES public.buildings (id) ON DELETE CASCADE,
  floor integer,
  number integer,
  position integer,
  rooms integer,
  area numeric,
  price numeric,
  price_per_meter numeric,
  status text NOT NULL DEFAULT 'available',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  url text NOT NULL
);

ALTER TABLE public.complexes
  ADD CONSTRAINT complexes_realtor_commission_type_check
  CHECK (realtor_commission_type IN ('none', 'percent', 'fixed_rub', 'rub_per_m2'));

CREATE INDEX idx_complexes_developer ON public.complexes (developer_id);
CREATE INDEX idx_buildings_complex ON public.buildings (complex_id);
CREATE INDEX idx_units_building ON public.units (building_id);
CREATE INDEX idx_images_entity ON public.images (entity_type, entity_id);

-- RLS: публичное чтение каталога (для витрины)
ALTER TABLE public.developers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complexes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_developers" ON public.developers FOR SELECT USING (true);
CREATE POLICY "read_complexes" ON public.complexes FOR SELECT USING (true);
CREATE POLICY "read_buildings" ON public.buildings FOR SELECT USING (true);
CREATE POLICY "read_units" ON public.units FOR SELECT USING (true);
CREATE POLICY "read_images" ON public.images FOR SELECT USING (true);

-- MVP: полный доступ anon (замените на service role / auth в продакшене)
CREATE POLICY "write_developers" ON public.developers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "write_complexes" ON public.complexes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "write_buildings" ON public.buildings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "write_units" ON public.units FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "write_images" ON public.images FOR ALL USING (true) WITH CHECK (true);

-- Storage: bucket "images" создайте в Dashboard → Storage → New bucket (public).
-- Политики Storage настройте для загрузки с клиента (см. README в supabase/).
