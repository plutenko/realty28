-- =============================================================================
-- Собрано скриптом: npm run db:migrate:bundle
-- Вставка: Supabase Dashboard → SQL Editor → New query → вставить файл → Run
--
-- ВАЖНО: блок 001_newbuildings.sql УДАЛЯЕТ таблицы (DROP). Если база уже с данными,
--   удалите из этого файла всё от -- >>> BEGIN: 001_newbuildings.sql до -- <<< END: 001_newbuildings.sql
--
-- Миграция 023 удаляет устаревшие таблицы OAuth (если были).
--
-- После ручного Run журнал schema_migrations npm не знает — при необходимости:
--   npm run db:migrate:skip -- <имя_файла.sql>
-- =============================================================================


-- >>> BEGIN: 001_newbuildings.sql
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

-- <<< END: 001_newbuildings.sql

-- >>> BEGIN: 002_complexes_realtor_commission.sql
-- Добавляет модель комиссии риелтора на уровне ЖК.
-- Выполните после 001_newbuildings.sql.

ALTER TABLE public.complexes
  ADD COLUMN IF NOT EXISTS realtor_commission_type text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS realtor_commission_value numeric;

DO $$
BEGIN
  -- Ограничиваем типы комиссии допустимыми значениями.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'complexes_realtor_commission_type_check'
  ) THEN
    ALTER TABLE public.complexes
      ADD CONSTRAINT complexes_realtor_commission_type_check
      CHECK (realtor_commission_type IN ('none', 'percent', 'fixed_rub', 'rub_per_m2'));
  END IF;
END $$;

-- <<< END: 002_complexes_realtor_commission.sql

-- >>> BEGIN: 003_developer_managers.sql
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

-- <<< END: 003_developer_managers.sql

-- >>> BEGIN: 004_drop_developer_contacts.sql
-- Перенос legacy `developer_contacts` → единая таблица `developer_managers`, затем удаление старой таблицы.
-- Выполните после `003_developer_managers.sql`, если у вас уже была таблица developer_contacts.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'developer_contacts'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'developer_managers'
  ) THEN
    INSERT INTO public.developer_managers (
      id,
      developer_id,
      name,
      phone,
      short_description,
      messenger,
      created_at
    )
    SELECT
      dc.id,
      dc.developer_id,
      dc.name,
      dc.phone,
      dc.note,
      'telegram',
      dc.created_at
    FROM public.developer_contacts dc
    ON CONFLICT (id) DO NOTHING;

    DROP TABLE public.developer_contacts CASCADE;
  END IF;
END $$;

-- <<< END: 004_drop_developer_contacts.sql

-- >>> BEGIN: 005_collections_cian.sql
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

-- <<< END: 005_collections_cian.sql

-- >>> BEGIN: 006_buildings_units_per_floor.sql
-- Количество квартир на этаже для ровной шахматки
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS units_per_floor int NOT NULL DEFAULT 4;

-- <<< END: 006_buildings_units_per_floor.sql

-- >>> BEGIN: 007_sources_sync.sql
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

-- <<< END: 007_sources_sync.sql

-- >>> BEGIN: 008_sources_building_id.sql
-- Привязка источника к конкретному дому
ALTER TABLE public.sources
  ADD COLUMN IF NOT EXISTS building_id uuid REFERENCES public.buildings (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sources_building_id
  ON public.sources (building_id);

-- <<< END: 008_sources_building_id.sql

-- >>> BEGIN: 009_sources_building_fk_cascade.sql
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

-- <<< END: 009_sources_building_fk_cascade.sql

-- >>> BEGIN: 010_units_profitbase_sync.sql
-- Поддержка upsert Profitbase и пометки "неактуальных" по времени
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'units_building_id_number_key'
  ) THEN
    ALTER TABLE public.units
      ADD CONSTRAINT units_building_id_number_key UNIQUE (building_id, number);
  END IF;
END $$;

-- <<< END: 010_units_profitbase_sync.sql

-- >>> BEGIN: 011_sources_profitbase_type.sql
-- Добавляем тип источника profitbase
ALTER TABLE public.sources
  DROP CONSTRAINT IF EXISTS sources_type_check;

ALTER TABLE public.sources
  ADD CONSTRAINT sources_type_check
  CHECK (type IN ('google', 'csv', 'api', 'profitbase'));

-- <<< END: 011_sources_profitbase_type.sql

-- >>> BEGIN: 012_units_external_id.sql
-- Поддержка внешнего id для upsert из Profitbase
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS external_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'units_external_id_key'
  ) THEN
    ALTER TABLE public.units
      ADD CONSTRAINT units_external_id_key UNIQUE (external_id);
  END IF;
END $$;

-- <<< END: 012_units_external_id.sql

-- >>> BEGIN: 013_units_media_columns.sql
-- Добавляем медиа-поля для планировок/отделки в units.
-- Это поддерживает существующие UI-контролы (планировка/отделка) и прокси /api/admin/set-media.

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS layout_title text;

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS layout_image_url text;

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS finish_image_url text;

-- UI также использует эти поля в некоторых карточках/страницах.
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS orientation text;

-- Дополнительно (для совместимости с UnitCard.jsx)
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS area_m2 numeric;

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS price_rub numeric;

-- <<< END: 013_units_media_columns.sql

-- >>> BEGIN: 014_buildings_units_per_entrance.sql
-- Кол-во квартир по подъездам (могут отличаться).
-- Пример ввода: "4,5" означает 2 подъезда: первый по 4 квартиры, второй по 5.
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS units_per_entrance int[] NOT NULL DEFAULT '{}';

-- Для удобства: если units_per_floor пустой/не задан, фронт/код может использовать sum(units_per_entrance).
-- (Мы не меняем units_per_floor автоматически на уровне БД, это делается в админке.)

-- <<< END: 014_buildings_units_per_entrance.sql

-- >>> BEGIN: 015_units_grid_span.sql
-- Шахматка: объединение квартир по горизонтали и вертикали.
-- anchor: floor — верхний этаж объединения (как на карточке «сверху вниз»),
-- position — левая колонка; span_columns / span_floors — ширина и «высота» в ячейках.

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS span_columns integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS span_floors integer NOT NULL DEFAULT 1;

ALTER TABLE public.units DROP CONSTRAINT IF EXISTS units_span_columns_check;
ALTER TABLE public.units DROP CONSTRAINT IF EXISTS units_span_floors_check;

ALTER TABLE public.units
  ADD CONSTRAINT units_span_columns_check CHECK (span_columns >= 1),
  ADD CONSTRAINT units_span_floors_check CHECK (span_floors >= 1);

-- <<< END: 015_units_grid_span.sql

-- >>> BEGIN: 016_images_floor_level.sql
-- Планы этажей: несколько изображений на один корпус (по номеру этажа).

ALTER TABLE public.images
  ADD COLUMN IF NOT EXISTS floor_level integer NULL;

COMMENT ON COLUMN public.images.floor_level IS
  'Для entity_type = building_floor_level_plan: номер этажа; NULL — как раньше (одна картинка на сущность).';

CREATE INDEX IF NOT EXISTS idx_images_building_floor_level
  ON public.images (entity_type, entity_id, floor_level);

-- <<< END: 016_images_floor_level.sql

-- >>> BEGIN: 017_units_entrance_combined.sql
-- Шахматка: подъезд/объединённые квартиры.
-- entrance: номер подъезда (1..N)
-- is_combined: квартира является результатом объединения нескольких
-- combined_unit_ids: какие квартиры были объединены в эту (uuid[]), для истории/аудита

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS entrance integer NULL,
  ADD COLUMN IF NOT EXISTS is_combined boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS combined_unit_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.units DROP CONSTRAINT IF EXISTS units_entrance_check;
ALTER TABLE public.units
  ADD CONSTRAINT units_entrance_check CHECK (entrance IS NULL OR entrance >= 1);

CREATE INDEX IF NOT EXISTS idx_units_building_entrance_floor
  ON public.units (building_id, entrance, floor);

-- <<< END: 017_units_entrance_combined.sql

-- >>> BEGIN: 018_profitbase_settings.sql
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

-- <<< END: 018_profitbase_settings.sql

-- >>> BEGIN: 019_buildings_handover_status.sql
ALTER TABLE public.buildings
ADD COLUMN IF NOT EXISTS handover_status text;

ALTER TABLE public.buildings
ADD COLUMN IF NOT EXISTS handover_quarter smallint;

ALTER TABLE public.buildings
ADD COLUMN IF NOT EXISTS handover_year integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'buildings_handover_status_check'
  ) THEN
    ALTER TABLE public.buildings
      ADD CONSTRAINT buildings_handover_status_check
      CHECK (handover_status IS NULL OR handover_status IN ('planned', 'delivered'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'buildings_handover_quarter_check'
  ) THEN
    ALTER TABLE public.buildings
      ADD CONSTRAINT buildings_handover_quarter_check
      CHECK (handover_quarter IS NULL OR handover_quarter BETWEEN 1 AND 4);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'buildings_handover_year_check'
  ) THEN
    ALTER TABLE public.buildings
      ADD CONSTRAINT buildings_handover_year_check
      CHECK (handover_year IS NULL OR handover_year BETWEEN 2000 AND 2100);
  END IF;
END $$;

-- <<< END: 019_buildings_handover_status.sql

-- >>> BEGIN: 020_sources_parser_sheet_sync_meta.sql
-- Parser kind, sheet tab name, sync stats for sources (Google Sheets шахматка и др.)

ALTER TABLE public.sources
  ADD COLUMN IF NOT EXISTS parser_type text,
  ADD COLUMN IF NOT EXISTS sheet_name text,
  ADD COLUMN IF NOT EXISTS last_sync_count integer,
  ADD COLUMN IF NOT EXISTS last_sync_error text;

-- Тип profitbase для уже существующих PB-источников (parser_type в UI).
UPDATE public.sources
SET parser_type = 'profitbase'
WHERE parser_type IS NULL
  AND type = 'profitbase';

-- <<< END: 020_sources_parser_sheet_sync_meta.sql

-- >>> BEGIN: 023_drop_google_oauth_tables.sql
-- Удаление таблиц OAuth «мой Google» (остался только сервисный аккаунт GOOGLE_SERVICE_ACCOUNT_JSON).

DROP TABLE IF EXISTS public.google_oauth_client CASCADE;
DROP TABLE IF EXISTS public.google_sheets_oauth CASCADE;

-- <<< END: 023_drop_google_oauth_tables.sql
