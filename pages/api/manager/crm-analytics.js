import { getSupabaseAdmin } from '../../../lib/supabaseServer'

async function requireAdminOrManager(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const supabase = getSupabaseAdmin()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!['admin', 'manager'].includes(profile?.role)) return null
  return { user, role: profile.role }
}

export default async function handler(req, res) {
  const caller = await requireAdminOrManager(req)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = getSupabaseAdmin()
  const { period = 'week' } = req.query

  let sinceIso = null
  if (period === 'today') {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    sinceIso = d.toISOString()
  } else if (period === 'week') {
    const d = new Date(); d.setDate(d.getDate() - 7)
    sinceIso = d.toISOString()
  } else if (period === 'month') {
    const d = new Date(); d.setDate(d.getDate() - 30)
    sinceIso = d.toISOString()
  }

  let q = supabase
    .from('leads')
    .select(`
      id, status, assigned_user_id, reaction_seconds, created_at,
      source_id,
      lead_sources(id, name, kind),
      profiles:assigned_user_id(id, name, email)
    `)
  if (sinceIso) q = q.gte('created_at', sinceIso)
  const { data: leads, error } = await q
  if (error) return res.status(500).json({ error: error.message })

  const totals = {
    leads: leads.length,
    taken: 0,
    unclaimed: 0,
    add_to_base: 0,
    in_work: 0,
    deal_done: 0,
    not_lead: 0,
    failed: 0,
    avg_reaction_sec: null,
  }
  const reactionTimes = []
  const bySource = {}
  const byRealtor = {}

  for (const l of leads) {
    if (l.assigned_user_id) totals.taken++
    else totals.unclaimed++

    if (l.status === 'add_to_base') totals.add_to_base++
    else if (l.status === 'in_work') totals.in_work++
    else if (l.status === 'deal_done') totals.deal_done++
    else if (l.status === 'not_lead') totals.not_lead++
    else if (l.status === 'failed') totals.failed++

    if (typeof l.reaction_seconds === 'number' && l.reaction_seconds >= 0) {
      reactionTimes.push(l.reaction_seconds)
    }

    // By source
    const sid = l.source_id || 'unknown'
    const sname = l.lead_sources?.name || 'Без источника'
    if (!bySource[sid]) {
      bySource[sid] = { id: sid, name: sname, leads: 0, taken: 0, deal_done: 0, failed: 0, not_lead: 0 }
    }
    bySource[sid].leads++
    if (l.assigned_user_id) bySource[sid].taken++
    if (l.status === 'deal_done') bySource[sid].deal_done++
    else if (l.status === 'failed') bySource[sid].failed++
    else if (l.status === 'not_lead') bySource[sid].not_lead++

    // By realtor
    if (l.assigned_user_id) {
      const uid = l.assigned_user_id
      const uname = l.profiles?.name || l.profiles?.email || '—'
      if (!byRealtor[uid]) {
        byRealtor[uid] = {
          id: uid, name: uname,
          taken: 0, in_work: 0, deal_done: 0, not_lead: 0, failed: 0,
          reaction_seconds_sum: 0, reaction_seconds_count: 0,
        }
      }
      byRealtor[uid].taken++
      if (l.status === 'in_work') byRealtor[uid].in_work++
      else if (l.status === 'deal_done') byRealtor[uid].deal_done++
      else if (l.status === 'not_lead') byRealtor[uid].not_lead++
      else if (l.status === 'failed') byRealtor[uid].failed++
      if (typeof l.reaction_seconds === 'number' && l.reaction_seconds >= 0) {
        byRealtor[uid].reaction_seconds_sum += l.reaction_seconds
        byRealtor[uid].reaction_seconds_count++
      }
    }
  }

  if (reactionTimes.length) {
    totals.avg_reaction_sec = Math.round(
      reactionTimes.reduce((a, b) => a + b, 0) / reactionTimes.length
    )
  }

  // Конверсии: taken/leads, deal_done/taken
  totals.take_rate = totals.leads > 0 ? Math.round(totals.taken * 100 / totals.leads) : 0
  totals.close_rate = totals.taken > 0 ? Math.round(totals.deal_done * 100 / totals.taken) : 0

  const sourcesArr = Object.values(bySource).map(s => ({
    ...s,
    conversion_pct: s.leads > 0 ? Math.round(s.deal_done * 100 / s.leads) : 0,
  })).sort((a, b) => b.leads - a.leads)

  const realtorsArr = Object.values(byRealtor).map(r => ({
    ...r,
    avg_reaction_sec: r.reaction_seconds_count > 0
      ? Math.round(r.reaction_seconds_sum / r.reaction_seconds_count) : null,
    conversion_pct: r.taken > 0 ? Math.round(r.deal_done * 100 / r.taken) : 0,
  })).sort((a, b) => b.taken - a.taken)

  return res.status(200).json({
    period,
    totals,
    by_source: sourcesArr,
    by_realtor: realtorsArr,
  })
}
