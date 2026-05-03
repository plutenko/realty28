/**
 * Минимальный коннектор Я.Директ Reports API v5.
 *
 * Использование:
 *   import { syncYandexDirect } from '../lib/yandexDirect'
 *   await syncYandexDirect(supabase, { dateFrom, dateTo })
 *
 * Auth:
 *   - YANDEX_DIRECT_OAUTH_TOKEN — обязательно
 *   - YANDEX_DIRECT_CLIENT_LOGIN — для агентских / организационных кабинетов
 *     передаётся в заголовок Client-Login (без него API подразумевает
 *     личный кабинет владельца токена).
 */

const API_BASE = 'https://api.direct.yandex.com/json/v5'

function makeHeaders(extra = {}) {
  const h = {
    Authorization: `Bearer ${process.env.YANDEX_DIRECT_OAUTH_TOKEN}`,
    'Accept-Language': 'ru',
    'Content-Type': 'application/json; charset=utf-8',
    ...extra,
  }
  if (process.env.YANDEX_DIRECT_CLIENT_LOGIN) {
    h['Client-Login'] = process.env.YANDEX_DIRECT_CLIENT_LOGIN
  }
  return h
}

async function ydCall(path, body) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: makeHeaders(),
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  return { http: r.status, ...data }
}

async function ydReport(dateFrom, dateTo) {
  const headers = makeHeaders({
    processingMode: 'auto',
    returnMoneyInMicros: 'false',
    skipReportHeader: 'true',
    skipColumnHeader: 'false', // нам нужен header чтобы парсить
    skipReportSummary: 'true',
  })
  const body = {
    params: {
      SelectionCriteria: { DateFrom: dateFrom, DateTo: dateTo },
      FieldNames: ['Date', 'CampaignId', 'CampaignName', 'Impressions', 'Clicks', 'Cost'],
      ReportName: `daily-${dateFrom}-${dateTo}-${Date.now()}`,
      ReportType: 'CAMPAIGN_PERFORMANCE_REPORT',
      DateRangeType: 'CUSTOM_DATE',
      Format: 'TSV',
      IncludeVAT: 'YES',
      IncludeDiscount: 'YES',
    },
  }
  const url = `${API_BASE}/reports`
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    if (r.status === 200) return await r.text()
    if (r.status === 201 || r.status === 202) {
      // Я.Директ положил в очередь, ждём 5с и ретраим (с processingMode=auto это редко).
      await new Promise((res) => setTimeout(res, 5000))
      continue
    }
    const text = await r.text().catch(() => '')
    throw new Error(`Y.Direct report HTTP ${r.status}: ${text.slice(0, 300)}`)
  }
  throw new Error('Y.Direct report stayed in queue after 3 attempts')
}

function parseReportTsv(tsv) {
  const lines = String(tsv).replace(/^﻿/, '').trim().split('\n')
  if (lines.length < 2) return []
  const header = lines[0].split('\t').map((s) => s.trim())
  const idx = (name) => header.indexOf(name)
  const out = []
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t')
    if (parts.length < header.length) continue
    const cost = parts[idx('Cost')] ?? '0'
    out.push({
      date: parts[idx('Date')],
      campaignId: parts[idx('CampaignId')],
      campaignName: parts[idx('CampaignName')] || '',
      impressions: Number(parts[idx('Impressions')] || 0),
      clicks: Number(parts[idx('Clicks')] || 0),
      // Cost приходит как "1234.56" с точкой (или с запятой в зависимости от Accept-Language).
      // Переводим в копейки чтобы не таскать float.
      spentKop: Math.round(Number(String(cost).replace(',', '.')) * 100),
    })
  }
  return out
}

function mapStatus(status, state) {
  if (state === 'ARCHIVED') return 'archived'
  if (state === 'OFF') return 'paused'
  if (state === 'ON' && status === 'ACCEPTED') return 'active'
  return 'paused'
}

/**
 * Главная функция синка. Идемпотентна — upsert по (channel, ext_id) для кампаний
 * и (date, channel, campaign_id) для расходов. Безопасно вызывать сколько угодно раз.
 *
 * @param supabase service-role клиент
 * @param opts { dateFrom?: 'YYYY-MM-DD', dateTo?: 'YYYY-MM-DD' }
 * @returns { campaigns: N, spend: M }
 */
export async function syncYandexDirect(supabase, opts = {}) {
  if (!process.env.YANDEX_DIRECT_OAUTH_TOKEN) {
    throw new Error('YANDEX_DIRECT_OAUTH_TOKEN not configured')
  }
  const today = new Date()
  const dateTo = opts.dateTo || today.toISOString().slice(0, 10)
  const dateFrom = opts.dateFrom || new Date(today.getTime() - 7 * 86400_000).toISOString().slice(0, 10)

  // 1. Кампании
  const c = await ydCall('/campaigns', {
    method: 'get',
    params: {
      SelectionCriteria: {},
      FieldNames: ['Id', 'Name', 'Status', 'State', 'Type'],
    },
  })
  if (c.error) {
    throw new Error(`Y.Direct campaigns: [${c.error.error_code}] ${c.error.error_string}: ${c.error.error_detail || ''}`)
  }
  const campaigns = c.result?.Campaigns ?? []

  let campaignsUpserted = 0
  for (const item of campaigns) {
    const { error } = await supabase.from('ad_campaigns').upsert(
      {
        channel: 'yandex_direct',
        ext_id: String(item.Id),
        name: item.Name || `Campaign ${item.Id}`,
        status: mapStatus(item.Status, item.State),
        utm_source: 'yandex',
        utm_campaign: String(item.Id),
        meta: { type: item.Type, state: item.State, raw_status: item.Status },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'channel,ext_id' },
    )
    if (!error) campaignsUpserted++
  }

  // 2. Маппинг ext_id → internal uuid
  const { data: dbCampaigns } = await supabase
    .from('ad_campaigns')
    .select('id, ext_id')
    .eq('channel', 'yandex_direct')
  const idMap = new Map((dbCampaigns ?? []).map((c) => [c.ext_id, c.id]))

  // 3. Расходы (CAMPAIGN_PERFORMANCE_REPORT по дням)
  const tsv = await ydReport(dateFrom, dateTo)
  const rows = parseReportTsv(tsv)

  let spendUpserted = 0
  for (const r of rows) {
    const internal = idMap.get(r.campaignId)
    if (!internal) continue // кампания может быть удалена/архивирована и не вернулась в /campaigns
    const { error } = await supabase.from('ad_spend').upsert(
      {
        date: r.date,
        channel: 'yandex_direct',
        campaign_id: internal,
        impressions: r.impressions,
        clicks: r.clicks,
        spent_kop: r.spentKop,
        meta: { campaign_name: r.campaignName },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'date,channel,campaign_id' },
    )
    if (!error) spendUpserted++
  }

  return {
    campaigns: campaignsUpserted,
    spend: spendUpserted,
    date_from: dateFrom,
    date_to: dateTo,
  }
}
