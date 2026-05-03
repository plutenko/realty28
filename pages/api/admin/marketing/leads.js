import { getSupabaseAdmin } from '../../../../lib/supabaseServer'

const PERIOD_DAYS = {
  today: 0,
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
}

/**
 * GET /api/admin/marketing/leads?period=week&channel=yandex_direct&campaign_id=<uuid>
 *
 * Список лидов за период с фильтром:
 * - channel: yandex_direct/vk_ads/.../organic/manual/unknown — обязательно
 * - campaign_id: ext_id кампании (как сохранён в leads.utm.campaign) — опционально.
 *   Если null или 'unattributed' — лиды без привязки к кампании
 *
 * Возвращает имя/телефон/статус/yclid/название кампании/время — для отображения
 * в drill-down модалке /admin/marketing.
 *
 * Auth: admin/manager.
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
  const dateFromParam = String(req.query?.date_from || '')
  const dateToParam = String(req.query?.date_to || '')
  let sinceIso, untilIso
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFromParam) && /^\d{4}-\d{2}-\d{2}$/.test(dateToParam)) {
    sinceIso = `${dateFromParam}T00:00:00.000Z`
    untilIso = `${dateToParam}T23:59:59.999Z`
  } else {
    const days = PERIOD_DAYS[period] ?? 7
    sinceIso = new Date(Date.now() - (days || 1) * 24 * 60 * 60 * 1000).toISOString()
    untilIso = new Date().toISOString()
  }
  const channel = String(req.query?.channel || '')
  const campaignExtId = req.query?.campaign_ext_id ? String(req.query.campaign_ext_id) : null
  const unattributed = req.query?.campaign_ext_id === 'unattributed'

  if (!channel) return res.status(400).json({ error: 'channel param required' })

  try {
    const { data: leads } = await supabase
      .from('leads')
      .select('id, name, phone, status, utm, yclid, deal_revenue_kop, created_at, assigned_user_id, profiles:assigned_user_id(name), lead_sources:source_id(id, kind, name)')
      .gte('created_at', sinceIso)
      .lte('created_at', untilIso)
      .order('created_at', { ascending: false })

    // Имена кампаний для матчинга
    const { data: campaigns } = await supabase
      .from('ad_campaigns')
      .select('ext_id, name, channel')
    const campaignNameByExtId = new Map(
      (campaigns ?? []).map((c) => [`${c.channel}::${c.ext_id}`, c.name]),
    )

    const filtered = []
    for (const l of leads ?? []) {
      const utmSource = String(l?.utm?.source || '').toLowerCase().trim()
      const leadChannel = utmSource
        ? normalizeChannel(utmSource)
        : 'unknown'
      if (leadChannel !== channel) continue

      const utmCampaign = l?.utm?.campaign ? String(l.utm.campaign) : null

      if (unattributed) {
        // только лиды без utm.campaign или с campaign которая не нашлась в нашем справочнике
        if (utmCampaign && campaignNameByExtId.has(`${channel}::${utmCampaign}`)) continue
      } else if (campaignExtId) {
        // только лиды с конкретной кампанией
        if (utmCampaign !== campaignExtId) continue
      }

      filtered.push({
        id: l.id,
        name: l.name || '—',
        phone: l.phone || '—',
        status: l.status,
        yclid: l.yclid,
        utm_campaign: utmCampaign,
        utm_content: l?.utm?.content || null,
        utm_term: l?.utm?.term || null,
        campaign_name: utmCampaign ? campaignNameByExtId.get(`${channel}::${utmCampaign}`) || null : null,
        created_at: l.created_at,
        assigned_user: l.profiles?.name || null,
        source_name: l.lead_sources?.name || null,
        source_kind: l.lead_sources?.kind || null,
        deal_revenue_rub: l.deal_revenue_kop ? l.deal_revenue_kop / 100 : null,
      })
    }

    return res.status(200).json({
      total: filtered.length,
      leads: filtered,
    })
  } catch (e) {
    console.error('[admin/marketing/leads] error:', e)
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
