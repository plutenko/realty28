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
 * Возвращает агрегацию по каналам рекламы с drill-down до кампаний:
 *
 * channels: [{
 *   channel: 'yandex_direct',
 *   leads / taken / deals / lost — счётчики по утилу.source = yandex
 *   impressions / clicks / spent_rub — из ad_spend
 *   cpl / cpd / conv / ctr
 *   campaigns: [{
 *     campaign_id, ext_id, name, status,
 *     impressions / clicks / spent_rub,
 *     leads / deals (matched by utm.campaign == ext_id)
 *     cpl / cpd
 *   }]
 * }]
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

  // Период: произвольный (date_from / date_to) с приоритетом, иначе legacy ?period=
  const period = String(req.query?.period || 'week')
  const dateFromParam = String(req.query?.date_from || '')
  const dateToParam = String(req.query?.date_to || '')
  let sinceDay
  let untilDay
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFromParam) && /^\d{4}-\d{2}-\d{2}$/.test(dateToParam)) {
    sinceDay = dateFromParam
    untilDay = dateToParam
  } else {
    const days = PERIOD_DAYS[period] ?? 7
    const sinceDate = new Date(Date.now() - (days || 1) * 24 * 60 * 60 * 1000)
    sinceDay = sinceDate.toISOString().slice(0, 10)
    untilDay = new Date().toISOString().slice(0, 10)
  }
  // ISO с временем — для фильтра по created_at в leads (timestamptz)
  const sinceIso = `${sinceDay}T00:00:00.000Z`
  const untilIso = `${untilDay}T23:59:59.999Z`
  const today = untilDay
  const days_count = Math.max(
    1,
    Math.round((Date.parse(today) - Date.parse(sinceDay)) / 86400_000) + 1,
  )

  try {
    // 1. Лиды за период с utm и yclid
    const { data: leads, error: leadsErr } = await supabase
      .from('leads')
      .select('id, status, utm, yclid, created_at, lead_sources:source_id(kind, name)')
      .gte('created_at', sinceIso)
      .lte('created_at', untilIso)
    if (leadsErr) throw leadsErr

    // 2. Расходы за период
    const { data: spend, error: spendErr } = await supabase
      .from('ad_spend')
      .select('date, channel, campaign_id, impressions, clicks, spent_kop')
      .gte('date', sinceDay)
      .lte('date', today)
    if (spendErr) throw spendErr

    // 3. Справочник кампаний
    const { data: campaignsRaw } = await supabase
      .from('ad_campaigns')
      .select('id, channel, ext_id, name, status, utm_campaign, utm_source')
    const campaignsById = new Map((campaignsRaw ?? []).map((c) => [c.id, c]))
    const campaignsByExtId = new Map(
      (campaignsRaw ?? []).map((c) => [`${c.channel}::${c.ext_id}`, c]),
    )

    // 4. Агрегируем расходы по каналу и кампании
    const byChannel = new Map() // channel -> {leads,taken,deals,lost,impressions,clicks,spent_kop, campaigns: Map<campaign_id, agg>}
    function ensureChannel(name) {
      if (!byChannel.has(name)) {
        byChannel.set(name, {
          leads: 0,
          taken: 0,
          deals: 0,
          lost: 0,
          impressions: 0,
          clicks: 0,
          spent_kop: 0,
          campaigns: new Map(),
        })
      }
      return byChannel.get(name)
    }
    function ensureCampaign(channelAgg, campaignId) {
      const m = channelAgg.campaigns
      if (!m.has(campaignId)) {
        m.set(campaignId, {
          campaign_id: campaignId,
          impressions: 0,
          clicks: 0,
          spent_kop: 0,
          leads: 0,
          taken: 0,
          deals: 0,
          lost: 0,
        })
      }
      return m.get(campaignId)
    }

    for (const s of spend ?? []) {
      const channel = normalizeChannel(s.channel)
      const ch = ensureChannel(channel)
      ch.impressions += Number(s.impressions || 0)
      ch.clicks += Number(s.clicks || 0)
      ch.spent_kop += Number(s.spent_kop || 0)
      if (s.campaign_id) {
        const c = ensureCampaign(ch, s.campaign_id)
        c.impressions += Number(s.impressions || 0)
        c.clicks += Number(s.clicks || 0)
        c.spent_kop += Number(s.spent_kop || 0)
      }
    }

    // 5. Привязываем лиды к каналу (utm.source) и кампании (utm.campaign matched по ext_id)
    for (const l of leads ?? []) {
      const utmSource = String(l?.utm?.source || '').toLowerCase().trim()
      const channel = utmSource
        ? normalizeChannel(utmSource)
        : l?.lead_sources?.kind === 'marquiz'
        ? 'organic'
        : l?.lead_sources?.kind === 'manual'
        ? 'manual'
        : 'unknown'

      const ch = ensureChannel(channel)
      ch.leads += 1
      if (l.status !== 'new') ch.taken += 1
      if (l.status === 'deal_done') ch.deals += 1
      if (l.status === 'failed' || l.status === 'not_lead') ch.lost += 1

      // matching to campaign: utm.campaign == ad_campaigns.ext_id
      const utmCampaign = l?.utm?.campaign ? String(l.utm.campaign) : null
      if (utmCampaign) {
        // find campaign in this channel
        const matchKey = `${channel}::${utmCampaign}`
        const matchedCampaign = campaignsByExtId.get(matchKey)
        if (matchedCampaign) {
          const c = ensureCampaign(ch, matchedCampaign.id)
          c.leads += 1
          if (l.status !== 'new') c.taken += 1
          if (l.status === 'deal_done') c.deals += 1
          if (l.status === 'failed' || l.status === 'not_lead') c.lost += 1
        }
      }
    }

    // 6. Сериализуем в финальный массив
    const channels = []
    for (const [channelName, agg] of byChannel) {
      const spentRub = agg.spent_kop / 100
      const campaigns = []
      for (const [campaignId, ca] of agg.campaigns) {
        const meta = campaignsById.get(campaignId)
        const caSpent = ca.spent_kop / 100
        campaigns.push({
          campaign_id: campaignId,
          ext_id: meta?.ext_id || null,
          name: meta?.name || `(unknown ${String(campaignId).slice(0, 8)})`,
          status: meta?.status || 'unknown',
          impressions: ca.impressions,
          clicks: ca.clicks,
          spent_rub: caSpent,
          leads: ca.leads,
          taken: ca.taken,
          deals: ca.deals,
          lost: ca.lost,
          cpl_rub: ca.leads ? Math.round(caSpent / ca.leads) : null,
          cpd_rub: ca.deals ? Math.round(caSpent / ca.deals) : null,
          ctr_pct: ca.impressions ? Number(((ca.clicks / ca.impressions) * 100).toFixed(2)) : null,
          conv_pct: ca.leads ? Number(((ca.deals / ca.leads) * 100).toFixed(2)) : 0,
        })
      }
      // Сортируем кампании: активные первыми, потом по расходу
      campaigns.sort((a, b) => {
        const aActive = a.status === 'active' ? 0 : 1
        const bActive = b.status === 'active' ? 0 : 1
        if (aActive !== bActive) return aActive - bActive
        return (b.spent_rub || 0) - (a.spent_rub || 0)
      })

      // Если у канала есть лиды без атрибуции к кампании — добавим виртуальную строку
      const attributedLeads = campaigns.reduce((s, c) => s + c.leads, 0)
      const unattributedLeads = agg.leads - attributedLeads
      if (unattributedLeads > 0) {
        const attributedDeals = campaigns.reduce((s, c) => s + c.deals, 0)
        const unattributedDeals = agg.deals - attributedDeals
        campaigns.push({
          campaign_id: null,
          ext_id: null,
          name: '(без привязки к кампании)',
          status: 'unattributed',
          impressions: 0,
          clicks: 0,
          spent_rub: 0,
          leads: unattributedLeads,
          taken: 0,
          deals: Math.max(0, unattributedDeals),
          lost: 0,
          cpl_rub: null,
          cpd_rub: null,
          ctr_pct: null,
          conv_pct: unattributedLeads
            ? Number(((Math.max(0, unattributedDeals) / unattributedLeads) * 100).toFixed(2))
            : 0,
        })
      }

      channels.push({
        channel: channelName,
        leads: agg.leads,
        taken: agg.taken,
        deals: agg.deals,
        lost: agg.lost,
        impressions: agg.impressions,
        clicks: agg.clicks,
        spent_rub: spentRub,
        cpl_rub: agg.leads ? Math.round(spentRub / agg.leads) : null,
        cpd_rub: agg.deals ? Math.round(spentRub / agg.deals) : null,
        conv_pct: agg.leads ? Number(((agg.deals / agg.leads) * 100).toFixed(2)) : 0,
        ctr_pct: agg.impressions ? Number(((agg.clicks / agg.impressions) * 100).toFixed(2)) : null,
        campaigns,
      })
    }
    channels.sort((a, b) => (b.spent_rub || 0) - (a.spent_rub || 0) || b.leads - a.leads)

    // 7. Sync logs
    const { data: syncs } = await supabase
      .from('ad_sync_runs')
      .select('channel, started_at, finished_at, status, rows_upserted, error')
      .order('started_at', { ascending: false })
      .limit(10)

    return res.status(200).json({
      period,
      since: sinceIso,
      since_date: sinceDay,
      until_date: today,
      days_count,
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
