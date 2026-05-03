-- 064: Вал — сумма вознаграждения риелтора с продажи (deal_done).
--
-- При закрытии лида в сделку (status → deal_done) обязательно вводить «Вал»
-- (комиссия риелтора с этой сделки). Хранится в копейках для точности.
-- Используется на странице /admin/marketing для расчёта ROAS = вал / расход.

alter table public.leads
  add column if not exists deal_revenue_kop bigint;

create index if not exists leads_deal_revenue_idx on public.leads(deal_revenue_kop)
  where deal_revenue_kop is not null;

comment on column public.leads.deal_revenue_kop is
  'Вал — комиссия риелтора с продажи в копейках. Заполняется при переходе лида в deal_done. Используется в /admin/marketing для расчёта ROAS.';
