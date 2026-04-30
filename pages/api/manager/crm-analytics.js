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

  // period → начало окна + тип корзины для графика
  //   today → сегодня с 00:00, bucket = hour (24 корзины)
  //   week → 7 дней назад, bucket = day (7 корзин)
  //   month → 30 дней назад, bucket = day (30 корзин)
  //   quarter → 90 дней назад, bucket = week (~13 корзин)
  //   year → 365 дней назад, bucket = month (12 корзин)
  //   all → без фильтра, bucket = month
  let sinceIso = null
  let bucket = 'day'
  if (period === 'today') {
    const d = new Date(); d.setHours(0, 0, 0, 0); sinceIso = d.toISOString(); bucket = 'hour'
  } else if (period === 'week') {
    const d = new Date(); d.setDate(d.getDate() - 7); sinceIso = d.toISOString(); bucket = 'day'
  } else if (period === 'month') {
    const d = new Date(); d.setDate(d.getDate() - 30); sinceIso = d.toISOString(); bucket = 'day'
  } else if (period === 'quarter') {
    const d = new Date(); d.setDate(d.getDate() - 90); sinceIso = d.toISOString(); bucket = 'week'
  } else if (period === 'year') {
    const d = new Date(); d.setDate(d.getDate() - 365); sinceIso = d.toISOString(); bucket = 'month'
  } else if (period === 'all') {
    bucket = 'month'
  }

  // Soft-cap: даже за год лидов сейчас < 5k, лимит 50k защищает от случайного
  // вычитывания миллионов записей если в будущем база сильно вырастет.
  // Когда будет много данных — переходим на SQL-агрегацию (GROUP BY).
  let q = supabase
    .from('leads')
    .select(`
      id, status, assigned_user_id, reaction_seconds, created_at,
      source_id,
      lead_sources(id, name, kind),
      profiles:assigned_user_id(id, name, email)
    `)
    .limit(50000)
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

  const timeseries = buildTimeseries(leads, bucket, sinceIso)

  return res.status(200).json({
    period,
    bucket,
    totals,
    by_source: sourcesArr,
    by_realtor: realtorsArr,
    timeseries,
  })
}

function buildTimeseries(leads, bucket, sinceIso) {
  // Возвращаем массив { label, date_start_iso, leads, taken, deal_done }
  if (!leads || leads.length === 0) return []

  const start = sinceIso ? new Date(sinceIso) : new Date(leads.reduce((min, l) => {
    const t = new Date(l.created_at).getTime()
    return Math.min(min, t)
  }, Date.now()))
  const end = new Date()

  const buckets = []
  const cursor = new Date(start)

  if (bucket === 'hour') {
    cursor.setMinutes(0, 0, 0)
    while (cursor <= end) {
      const next = new Date(cursor); next.setHours(next.getHours() + 1)
      buckets.push({
        start: new Date(cursor),
        end: next,
        label: `${String(cursor.getHours()).padStart(2, '0')}:00`,
      })
      cursor.setHours(cursor.getHours() + 1)
    }
  } else if (bucket === 'day') {
    cursor.setHours(0, 0, 0, 0)
    while (cursor <= end) {
      const next = new Date(cursor); next.setDate(next.getDate() + 1)
      buckets.push({
        start: new Date(cursor),
        end: next,
        label: `${String(cursor.getDate()).padStart(2, '0')}.${String(cursor.getMonth() + 1).padStart(2, '0')}`,
      })
      cursor.setDate(cursor.getDate() + 1)
    }
  } else if (bucket === 'week') {
    // Выравниваем на понедельник
    const dow = cursor.getDay() || 7
    cursor.setDate(cursor.getDate() - (dow - 1))
    cursor.setHours(0, 0, 0, 0)
    while (cursor <= end) {
      const next = new Date(cursor); next.setDate(next.getDate() + 7)
      buckets.push({
        start: new Date(cursor),
        end: next,
        label: `${String(cursor.getDate()).padStart(2, '0')}.${String(cursor.getMonth() + 1).padStart(2, '0')}`,
      })
      cursor.setDate(cursor.getDate() + 7)
    }
  } else if (bucket === 'month') {
    cursor.setDate(1); cursor.setHours(0, 0, 0, 0)
    while (cursor <= end) {
      const next = new Date(cursor); next.setMonth(next.getMonth() + 1)
      const months = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']
      buckets.push({
        start: new Date(cursor),
        end: next,
        label: `${months[cursor.getMonth()]} ${String(cursor.getFullYear()).slice(2)}`,
      })
      cursor.setMonth(cursor.getMonth() + 1)
    }
  }

  const series = buckets.map(b => ({
    label: b.label,
    date_start_iso: b.start.toISOString(),
    leads: 0,
    taken: 0,
    deal_done: 0,
  }))

  for (const l of leads) {
    const t = new Date(l.created_at).getTime()
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i]
      if (t >= b.start.getTime() && t < b.end.getTime()) {
        series[i].leads++
        if (l.assigned_user_id) series[i].taken++
        if (l.status === 'deal_done') series[i].deal_done++
        break
      }
    }
  }

  return series
}
