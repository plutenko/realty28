import { getSupabaseAdmin } from '../../../../lib/supabaseServer'

async function requireAdmin(req, supabase) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' || profile?.role === 'manager' ? user : null
}

const METRIC_KEYS = [
  'cold_calls', 'leaflet', 'activations', 'meetings', 'consultations',
  'repeat_touch', 'shows_objects_count', 'ad_exclusive', 'ad_search',
  'new_buildings_presentations', 'deposits', 'revenue', 'selection',
]

function formatRu(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function addDaysIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

function diffDaysIso(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

function startOfMonthIso(iso) {
  const [y, m] = iso.split('-').map(Number)
  return `${y}-${String(m).padStart(2, '0')}-01`
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ')
}

function pct(num, den) {
  if (!den) return '—'
  return `${Math.round((num / den) * 100)}%`
}

async function aggregate(supabase, from, to) {
  const { data } = await supabase
    .from('daily_reports')
    .select(`id, user_id, date_from, date_to, absence_type, is_valid, ${METRIC_KEYS.join(', ')}`)
    .lte('date_from', to)
    .gte('date_to', from)
    .eq('is_valid', true)

  const totals = Object.fromEntries(METRIC_KEYS.map((k) => [k, 0]))
  let depositsCount = 0
  for (const r of data || []) {
    if (r.absence_type) continue
    for (const k of METRIC_KEYS) totals[k] += Number(r[k] || 0)
    if (Number(r.deposits || 0) > 0) depositsCount++
  }
  return { totals, depositsCount, rows: data || [] }
}

export default async function handler(req, res) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

  const caller = await requireAdmin(req, supabase)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'from/to в формате YYYY-MM-DD обязательны' })
  }

  // Текущий период
  const cur = await aggregate(supabase, from, to)

  // Предыдущий — такой же длины, сдвинут назад
  const days = diffDaysIso(from, to) + 1
  const prevTo = addDaysIso(from, -1)
  const prevFrom = addDaysIso(prevTo, -(days - 1))
  const prev = await aggregate(supabase, prevFrom, prevTo)

  // Накопительно месяц — с 1 числа месяца до to
  const monthFrom = startOfMonthIso(to)
  const month = await aggregate(supabase, monthFrom, to)

  const val = cur.totals.revenue
  const prevVal = prev.totals.revenue
  const growth = prevVal ? Math.round(((val - prevVal) / prevVal) * 100) : null
  const growthStr = growth === null ? '___' : (growth > 0 ? `+${growth}` : String(growth))

  const avansSum = cur.totals.deposits
  const avansCount = cur.depositsCount
  const avgCheck = avansCount ? Math.round(avansSum / avansCount) : 0

  const consultations = cur.totals.consultations
  const adSearch = cur.totals.ad_search

  // Шаблон 1:1 из примера руководителя, плейсхолдеры "_____" для полей из CRM
  const txt =
`недельный отчет: отдел СОБР
${formatRu(from)} – ${formatRu(to)}

1. ДЕНЬГИ
  ➤ Основные показатели
Вал за период — ${fmtMoney(val)} ₽
(прирост к прошлому периоду ${growthStr} % | прирост к плану _____ %)
Накопительно Вал за месяц — ${fmtMoney(month.totals.revenue)} ₽
(_____ % выполнения плана)
Авансы — ${avansCount} шт. на ${fmtMoney(avansSum)} ₽
▪ Новостройки — _____
▪ Вторичный рынок — _____
Средний чек сделки — ${fmtMoney(avgCheck)} ₽

2. РАБОТА С ПОКУПАТЕЛЕМ
  ➤ Лиды и обращения
Всего обращений — _____ шт.
Входящие звонки — _____ шт.
▪ Частные — _____ шт.
▪ Без ответа — _____ (_____ %)
Веб-обращения — _____ шт.
  ➤ Конверсии
Обращения / Консультации — _____ / ${consultations} = _____ %
Консультации / АДп — ${consultations} / ${adSearch} = ${pct(adSearch, consultations)}
`

  return res.status(200).json({
    text: txt,
    range: { from, to },
    auto: {
      revenue: val,
      revenue_prev: prevVal,
      revenue_growth: growth,
      revenue_month: month.totals.revenue,
      deposits_sum: avansSum,
      deposits_count: avansCount,
      avg_check: avgCheck,
      consultations,
      ad_search: adSearch,
    },
  })
}
