import { getSupabaseAdmin } from '../../../../lib/supabaseServer'

async function requireAdmin(req, supabase) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' || profile?.role === 'manager' ? user : null
}

/**
 * Вычисляет границы периода по типу и offset от "текущего".
 * timeZone: Asia/Yakutsk — вся логика в локальном календаре риелторов.
 */
function computeRange(periodType, offset, timeZone = 'Asia/Yakutsk') {
  const now = new Date()
  const nowLocalParts = localParts(now, timeZone)
  const y = nowLocalParts.year
  const m = nowLocalParts.month
  const d = nowLocalParts.day

  if (periodType === 'week') {
    // Неделя: Пн-Вс. JS Sunday=0 — смещаем чтобы воскр стало 7.
    const todayUTC = Date.UTC(y, m - 1, d)
    const dow = new Date(todayUTC).getUTCDay() || 7
    const monUTC = todayUTC - (dow - 1) * 86400000 + offset * 7 * 86400000
    const sunUTC = monUTC + 6 * 86400000
    return { from: toIso(monUTC), to: toIso(sunUTC), label: `Неделя ${formatRu(monUTC)}–${formatRu(sunUTC)}` }
  }

  if (periodType === 'month') {
    const targetMonth = m - 1 + offset
    const targetY = y + Math.floor(targetMonth / 12)
    const normMonth = ((targetMonth % 12) + 12) % 12
    const firstUTC = Date.UTC(targetY, normMonth, 1)
    const lastUTC = Date.UTC(targetY, normMonth + 1, 0)
    return { from: toIso(firstUTC), to: toIso(lastUTC), label: monthLabel(targetY, normMonth) }
  }

  if (periodType === 'quarter') {
    const currentQ = Math.floor((m - 1) / 3)
    const targetQ = currentQ + offset
    const targetY = y + Math.floor(targetQ / 4)
    const normQ = ((targetQ % 4) + 4) % 4
    const startMonth = normQ * 3
    const firstUTC = Date.UTC(targetY, startMonth, 1)
    const lastUTC = Date.UTC(targetY, startMonth + 3, 0)
    return { from: toIso(firstUTC), to: toIso(lastUTC), label: `${normQ + 1} квартал ${targetY}` }
  }

  if (periodType === 'year') {
    const targetY = y + offset
    const firstUTC = Date.UTC(targetY, 0, 1)
    const lastUTC = Date.UTC(targetY, 11, 31)
    return { from: toIso(firstUTC), to: toIso(lastUTC), label: `${targetY} год` }
  }

  throw new Error('unknown period')
}

function localParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]))
  return { year: +p.year, month: +p.month, day: +p.day }
}

function toIso(utcMs) {
  const d = new Date(utcMs)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function formatRu(utcMs) {
  const d = new Date(utcMs)
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]
function monthLabel(y, m0) { return `${MONTH_NAMES[m0]} ${y}` }

const METRIC_KEYS = [
  'cold_calls', 'leaflet', 'activations', 'meetings', 'consultations',
  'repeat_touch', 'shows_objects_count', 'shows_objects_objects', 'shows_clients_count',
  'ad_exclusive', 'ad_search', 'new_buildings_presentations', 'deposits', 'revenue', 'selection',
]

export default async function handler(req, res) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

  const caller = await requireAdmin(req, supabase)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  const periodType = String(req.query.period || 'week')
  const offset = parseInt(req.query.offset || '0', 10)

  let range
  try {
    range = computeRange(periodType, offset)
  } catch (e) {
    return res.status(400).json({ error: e.message })
  }

  const [realtorsRes, reportsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name, email, role, submits_reports, telegram_user_id, is_active')
      .in('role', ['realtor', 'manager'])
      .eq('submits_reports', true)
      .order('name'),
    supabase
      .from('daily_reports')
      .select(`id, user_id, date_from, date_to, absence_type, is_valid, submitted_at, ${METRIC_KEYS.join(', ')}`)
      .lte('date_from', range.to)
      .gte('date_to', range.from)
      .eq('is_valid', true),
  ])

  if (realtorsRes.error) return res.status(500).json({ error: realtorsRes.error.message })
  if (reportsRes.error) return res.status(500).json({ error: reportsRes.error.message })

  // Агрегируем по риелтору
  const byUser = new Map()

  // Сначала — все активные (они должны быть в списке даже если ничего не прислали)
  for (const r of realtorsRes.data || []) {
    if (r.is_active === false) continue
    byUser.set(r.id, {
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      is_active: true,
      submits_reports: r.submits_reports,
      bound: !!r.telegram_user_id,
      reports_count: 0,
      absence: null,
      metrics: Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])),
    })
  }

  // Подтягиваем имена уволенных с отчётами в этом периоде
  const reportUserIds = new Set((reportsRes.data || []).map((r) => r.user_id))
  const missingIds = [...reportUserIds].filter((id) => !byUser.has(id))
  if (missingIds.length) {
    const { data: firedUsers } = await supabase
      .from('profiles')
      .select('id, name, email, role, is_active')
      .in('id', missingIds)
    for (const r of firedUsers || []) {
      byUser.set(r.id, {
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        is_active: r.is_active !== false,
        submits_reports: false,
        bound: false,
        reports_count: 0,
        absence: null,
        metrics: Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])),
      })
    }
  }

  for (const rep of reportsRes.data || []) {
    const u = byUser.get(rep.user_id)
    if (!u) continue
    if (rep.absence_type) {
      u.absence = { type: rep.absence_type, from: rep.date_from, to: rep.date_to }
      continue
    }
    u.reports_count += 1
    for (const k of METRIC_KEYS) {
      u.metrics[k] += Number(rep[k] || 0)
    }
  }

  // Итого по отделу
  const totals = Object.fromEntries(METRIC_KEYS.map((k) => [k, 0]))
  for (const u of byUser.values()) {
    if (!u.absence) {
      for (const k of METRIC_KEYS) totals[k] += u.metrics[k]
    }
  }

  return res.status(200).json({
    range,
    period: periodType,
    offset,
    realtors: Array.from(byUser.values()),
    totals,
  })
}
