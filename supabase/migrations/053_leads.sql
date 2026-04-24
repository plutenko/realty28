-- CRM: распределение лидов из внешних источников (Марквиз, Тильда, ручной ввод).
-- Риелтор с profiles.crm_enabled=true получает уведомление в Домовой-бот,
-- первый жмущий «🔥 Беру» становится assigned_user_id (first-wins через
-- атомарный UPDATE ... WHERE status='new' AND assigned_user_id IS NULL).
--
-- Воронка (6 статусов, см. lead_status):
--   new → not_lead (комментарий обязателен)
--   new → add_to_base (→ уведомление админу)
--   add_to_base → in_work (админ/руководитель подтверждает внесение в базу)
--   in_work → deal_done
--   in_work → failed (комментарий обязателен)
-- Руководитель может переназначить лид или вернуть из терминального статуса в активный.

-- ============================================================================
-- profiles.crm_enabled: кому включить получение лидов
-- ============================================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS crm_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_crm_enabled
  ON profiles(crm_enabled) WHERE crm_enabled = true;

-- ============================================================================
-- lead_status enum — воронка
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM (
    'new',
    'not_lead',
    'add_to_base',
    'in_work',
    'deal_done',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- lead_sources: описание источников (квиз, лендинг, вручную)
-- source_key — длинный случайный ключ, участвует в webhook URL: /api/leads/webhook/<source_key>
-- ============================================================================
CREATE TABLE IF NOT EXISTS lead_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,                          -- 'marquiz' | 'tilda' | 'manual' | ...
  name text NOT NULL,                          -- «Марквиз — Подбор квартиры»
  source_key text NOT NULL UNIQUE,             -- mrq_a7f3e1b8c2d945e6f0a1b2c3d4e5f6a7
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_sources_kind ON lead_sources(kind);
CREATE INDEX IF NOT EXISTS idx_lead_sources_active ON lead_sources(is_active) WHERE is_active = true;

-- ============================================================================
-- leads: сами заявки
-- ============================================================================
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES lead_sources(id) ON DELETE SET NULL,

  status lead_status NOT NULL DEFAULT 'new',
  assigned_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_at timestamptz,

  -- контактные данные
  name text,
  phone text,
  phone_normalized text,                       -- +7XXXXXXXXXX, для дедупа и поиска
  email text,

  -- типовые поля квиза, для фильтров
  budget text,
  rooms text,

  -- полные ответы квиза и метаданные источника
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,       -- оригинальный payload от вебхука

  -- закрытие лида (not_lead/failed) — причина, задаётся риелтором
  close_reason text,
  closed_at timestamptz,

  -- авто-вычисляемое время реакции (от created_at до assigned_at), сек
  reaction_seconds integer,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_user_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source_id);
CREATE INDEX IF NOT EXISTS idx_leads_phone_norm ON leads(phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_new_unassigned
  ON leads(created_at) WHERE status = 'new' AND assigned_user_id IS NULL;

-- ============================================================================
-- lead_events: история изменений (для аудита и дашборда)
-- ============================================================================
CREATE TABLE IF NOT EXISTS lead_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  -- типы: 'created','taken','status_changed','reassigned','reopened','admin_confirmed','skipped'
  event_type text NOT NULL,
  from_status lead_status,
  to_status lead_status,
  comment text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON lead_events(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_events_actor ON lead_events(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_type ON lead_events(event_type);

-- ============================================================================
-- lead_notifications: сообщения в Telegram, которые надо редактировать
-- при захвате лида (у всех, кроме победителя — меняем на «🔒 Взял Иван, 47 сек»)
-- ============================================================================
CREATE TABLE IF NOT EXISTS lead_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  message_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_notifications_lead ON lead_notifications(lead_id);

-- ============================================================================
-- RLS — всё через service_role (API делает проверки через session auth)
-- ============================================================================
ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only lead_sources" ON lead_sources;
DROP POLICY IF EXISTS "Service role only leads" ON leads;
DROP POLICY IF EXISTS "Service role only lead_events" ON lead_events;
DROP POLICY IF EXISTS "Service role only lead_notifications" ON lead_notifications;

CREATE POLICY "Service role only lead_sources" ON lead_sources
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role only leads" ON leads
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role only lead_events" ON lead_events
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role only lead_notifications" ON lead_notifications
  FOR ALL USING (auth.role() = 'service_role');
