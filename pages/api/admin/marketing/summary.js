import { getSupabaseAdmin } from '../../../../lib/supabaseServer'

const PERIOD_DAYS = {
  today: 0,
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
}

/**
 * GET /api/admin/marketing/summary?period=week
 *
 * Возвращает агрегацию по каналам рекламы:
 *  - leads: количество лидов из этого источника за период
 *  - taken: сколько взято риелторами (status != new)
 *  - deals: deal_done
 *  - conv_pct: deals/leads
 *  - clicks/impressions/spent_kop: из ad_spend (если данные коннектора есть)
 *  - cpl: spent / leads — стоимость лида
 *  - cpd: spent / deals — стоимость сделки
 *
 * Канал = `utm.source` лида (нормализуется: 'yandex' / 'vk' / 'tg' / 'avito' / 'organic' / 'unknown').
 *
 * Auth: admin или manager.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'DB not configured' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!['admin', 'manager'].includes(profile?.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const period = String(req.query?.period || 'week')
  const days = PERIOD_DAYS[period] ?? 7
  const since = new Date(Date.now() - (days || 1) * 24 * 60 * 60 * 1000)
  const sinceIso = since.toISOString()
  const sinceDate = since.toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)

  try {
    // 1. Лиды за период с разбивкой по каналу
    const { data: leads, error: leadsErr } = await supabase
      .from('leads')
      .select('id, status, utm, yclid, created_at, lead_sources:source_id(kind, name)')
      .gte('created_at', sinceIso)
    if (leadsErr) throw leadsErr

    const channelKey = (lead) => {
      const src = String(lead?.utm?.source || '').toLowerCase().trim()
      if (src) return normalizeChannel(src)
      const kind = lead?.lead_sources?.kind
      if (kind === 'marquiz') return 'organic'
      if (kind === 'manual') return 'manual'
      return 'unknown'
    }

    const byChannel = new Map()
    for (const l of leads ?? []) {
      const k = channelKey(l)
      if (!byChannel.has(k)) byChannel.set(k, { leads: 0, taken: 0, deals: 0, lost: 0 })
      const b = byChannel.get(k)
      b.leads += 1
      if (l.status !== 'new') b.taken += 1
      if (l.status === 'deal_done') b.deals += 1
      if (l.status === 'failed' || l.status === 'not_lead') b.lost += 1
    }

    // 2. Расходы по каналам за период
    const { data: spend, error: spendErr } = await supabase
      .from('ad_spend')
      .select('channel, impressions, clicks, spent_kop')
      .gte('date', sinceDate)
      .lte('date', today)
    if (spendErr) throw spendErr

    for (const s of spend ?? []) {
      const k = normalizeChannel(s.channel)
      if (!byChannel.has(k)) byChannel.set(k, { leads: 0, taken: 0, deals: 0, lost: 0 })
      const b = byChannel.get(k)
      b.impressions = (b.impressions || 0) + Number(s.impressions || 0)
      b.clicks = (b.clicks || 0) + Number(s.clicks || 0)
      b.spent_kop = (b.spent_kop || 0) + Number(s.spent_kop || 0)
    }

    // 3. Считаем производные метрики
    const channels = []
    for (const [name, b] of byChannel) {
      const spentRub = (b.spent_kop || 0) / 100
      channels.push({
        channel: name,
        leads: b.leads || 0,
        taken: b.taken || 0,
        deals: b.deals || 0,
        lost: b.lost || 0,
        impressions: b.impressions || 0,
        clicks: b.clicks || 0,
        spent_rub: spentRub,
        cpl_rub: b.leads ? Math.round(spentRub / b.leads) : null,
        cpd_rub: b.deals ? Math.round(spentRub / b.deals) : null,
        conv_pct: b.leads ? Number(((b.deals / b.leads) * 100).toFixed(2)) : 0,
        ctr_pct: b.impressions ? Number(((b.clicks / b.impressions) * 100).toFixed(2)) : null,
      })
    }
    channels.sort((a, b) => (b.spent_rub || 0) + b.leads - ((a.spent_rub || 0) + a.leads))

    // 4. Последний sync — для индикации "ожидаются данные коннектора"
    const { data: syncs } = await supabase
      .from('ad_sync_runs')
      .select('channel, started_at, finished_at, status, rows_upserted')
      .order('started_at', { ascending: false })
      .limit(10)

    return res.status(200).json({
      period,
      since: sinceIso,
      channels,
      totals: {
        leads: channels.reduce((s, c) => s + c.leads, 0),
        deals: channels.reduce((s, c) => s + c.deals, 0),
        spent_rub: channels.reduce((s, c) => s + c.spent_rub, 0),
        clicks: channels.reduce((s, c) => s + c.clicks, 0),
      },
      recent_syncs: syncs ?? [],
    })
  } catch (e) {
    console.error('[admin/marketing/summary] error:', e)
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}

function normalizeChannel(raw) {
  const s = String(raw || '').toLowerCase().trim()
  if (!s) return 'unknown'
  if (/yand|direct/.test(s)) return 'yandex_direct'
  if (/vk|vkontakte|вк/.test(s)) return 'vk_ads'
  if (/telegram|tg-?ads/.test(s)) return 'telegram_ads'
  if (/avito|авито/.test(s)) return 'avito'
  if (/google|gads/.test(s)) return 'google_ads'
  if (s === 'organic') return 'organic'
  if (s === 'manual') return 'manual'
  return s
}
