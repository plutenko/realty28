-- 063: Marketing dashboard — yclid в лидах + таблицы кампаний и расходов.
--
-- Цель: показать в /admin/marketing честный cost-per-lead и cost-per-deal
-- по каналам рекламы (Я.Директ, в дальнейшем VK Ads / Telegram Ads / Avito).
-- yclid из URL объявлений Я.Директ → лид → matching на ad_campaigns по campaign_id
-- (yclid содержит campaign_id в первых байтах, но Я.Директ его не возвращает —
-- мы матчим по utm.campaign + расходам по дням).

-- 1. yclid в лидах для прямого матчинга с Я.Директ
alter table public.leads
  add column if not exists yclid text;

create index if not exists leads_yclid_idx on public.leads(yclid)
  where yclid is not null;

comment on column public.leads.yclid is
  'Yandex Click ID из URL объявления Я.Директ. Используется для матчинга лида с конкретной кампанией/объявлением.';

-- 2. Справочник рекламных кампаний (по всем каналам)
create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  channel text not null,                       -- 'yandex_direct', 'vk_ads', 'telegram_ads', 'avito', 'manual'
  ext_id text not null,                        -- ID кампании в системе канала (Я.Директ campaignId, VK ad_id, etc.)
  name text not null,
  status text default 'active',                -- 'active', 'paused', 'archived'
  utm_source text,                             -- ожидаемая utm_source для матчинга с лидами
  utm_campaign text,                           -- ожидаемая utm_campaign
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel, ext_id)
);

create index if not exists ad_campaigns_channel_idx on public.ad_campaigns(channel, status);
create index if not exists ad_campaigns_utm_idx on public.ad_campaigns(utm_source, utm_campaign)
  where utm_source is not null;

-- 3. Ежедневные расходы и метрики по кампаниям
-- Хранение в копейках (bigint) чтобы избежать float-погрешностей.
create table if not exists public.ad_spend (
  date date not null,
  channel text not null,
  campaign_id uuid references public.ad_campaigns(id) on delete cascade,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  spent_kop bigint not null default 0,
  meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(date, channel, campaign_id)
);

create index if not exists ad_spend_date_idx on public.ad_spend(date desc);
create index if not exists ad_spend_channel_date_idx on public.ad_spend(channel, date desc);

comment on table public.ad_spend is
  'Daily срез расходов и метрик по рекламным кампаниям. Заполняется коннекторами (Я.Директ API и т.п.) через cron.';
comment on column public.ad_spend.spent_kop is
  'Расход в копейках. spent_rub = spent_kop / 100.';

-- 4. Sync log — для отладки коннекторов
create table if not exists public.ad_sync_runs (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text,                                 -- 'success', 'partial', 'error'
  rows_upserted integer default 0,
  date_from date,
  date_to date,
  error text,
  meta jsonb default '{}'::jsonb
);

create index if not exists ad_sync_runs_channel_idx on public.ad_sync_runs(channel, started_at desc);

-- RLS — service role only (как и у leads)
alter table public.ad_campaigns enable row level security;
alter table public.ad_spend enable row level security;
alter table public.ad_sync_runs enable row level security;

-- Политики не создаём — service role bypasses RLS, anon/authenticated не должны видеть.
-- Доступ к данным только через server-side endpoints (admin/manager scope).
