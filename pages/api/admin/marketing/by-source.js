import { getSupabaseAdmin } from '../../../../lib/supabaseServer'

const PERIOD_DAYS = {
  today: 0,
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
}

/**
 * GET /api/admin/marketing/by-source?date_from=&date_to=
 *
 * Группировка лидов по lead_sources (Марквиз/Тильда/ручной ввод). Это
 * «откуда заявка пришла» — независимо от рекламного канала.
 *
 * Возвращает per-source: лиды, взято, сделки, срыв, конверсия.
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

  const dateFromParam = String(req.query?.date_from || '')
  const dateToParam = String(req.query?.date_to || '')
  let sinceIso, untilIso
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFromParam) && /^\d{4}-\d{2}-\d{2}$/.test(dateToParam)) {
    sinceIso = `${dateFromParam}T00:00:00.000Z`
    untilIso = `${dateToParam}T23:59:59.999Z`
  } else {
    const days = PERIOD_DAYS[String(req.query?.period || 'month')] ?? 30
    sinceIso = new Date(Date.now() - (days || 1) * 24 * 60 * 60 * 1000).toISOString()
    untilIso = new Date().toISOString()
  }

  try {
    const { data: leads } = await supabase
      .from('leads')
      .select('id, status, source_id, lead_sources:source_id(id, kind, name)')
      .gte('created_at', sinceIso)
      .lte('created_at', untilIso)

    const bySource = new Map()
    for (const l of leads ?? []) {
      const key = l.source_id || 'unknown'
      if (!bySource.has(key)) {
        bySource.set(key, {
          source_id: l.source_id,
          source_name: l.lead_sources?.name || '(без источника)',
          source_kind: l.lead_sources?.kind || 'unknown',
          leads: 0,
          taken: 0,
          deals: 0,
          lost: 0,
        })
      }
      const b = bySource.get(key)
      b.leads += 1
      if (l.status !== 'new') b.taken += 1
      if (l.status === 'deal_done') b.deals += 1
      if (l.status === 'failed' || l.status === 'not_lead') b.lost += 1
    }

    const sources = Array.from(bySource.values()).map((s) => ({
      ...s,
      conv_pct: s.leads ? Number(((s.deals / s.leads) * 100).toFixed(2)) : 0,
      take_rate_pct: s.leads ? Number(((s.taken / s.leads) * 100).toFixed(2)) : 0,
    }))
    sources.sort((a, b) => b.leads - a.leads)

    return res.status(200).json({ sources })
  } catch (e) {
    console.error('[admin/marketing/by-source] error:', e)
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}
