import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { getReportsSettings, DAILY_REPORT_COLUMNS } from '../../../../lib/reportsSettings'
import { sendToGroup } from '../../../../lib/reportsTelegram'
import {
  localParts,
  computeSummaryPeriod,
  formatRu,
  formatRuPeriodCompact,
  fmtMoney,
  isHoliday,
} from '../../../../lib/reportsCron'

const ABSENCE_LABEL = {
  day_off: 'выходной',
  vacation: 'отпуск',
  sick_leave: 'больничный',
}

/**
 * Утренняя сводка в 09:30 Asia/Yakutsk (= 00:30 UTC).
 * За вчерашний день (будни) или за Пт-Вс (если сегодня понедельник).
 *
 * Аутентификация: header `x-cron-secret` или query `?secret=...`.
 * `?dry=1` — вернуть текст без отправки.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end()

  const secret = req.headers['x-cron-secret'] || req.query.secret
  const expected = process.env.CRON_SECRET
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'no supabase' })

  const settings = await getReportsSettings(supabase)
  if (!settings) return res.status(500).json({ error: 'no settings' })

  const now = new Date()
  const nowLocal = localParts(now, settings.timezone || 'Asia/Yakutsk')
  const dry = req.query.dry === '1'

  // Ручная пересборка за конкретный день: ?date=YYYY-MM-DD — не считаем
  // автоматически «вчера» / batch, а берём именно эту дату (инвалидный отчёт
  // потом исправили; праздник/ask_day не мешает принудительной переотправке).
  const forcedDate = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : null

  if (!forcedDate && isHoliday(nowLocal.dateIso, settings)) {
    return res.status(200).json({ ok: true, skipped: 'holiday' })
  }

  const period = forcedDate
    ? { from: forcedDate, to: forcedDate, isBatch: false }
    : computeSummaryPeriod(nowLocal, settings)

  // Сводка актуальна только если вчера был ask_day (иначе сводить нечего).
  // Исключение — когда вчера было Вс, computeSummaryPeriod вернёт батч за Пт-Вс: ask_days уже содержит Sun.
  const DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const [py, pm, pd] = period.to.split('-').map(Number)
  const targetDow = DOW_NAMES[new Date(Date.UTC(py, pm - 1, pd)).getUTCDay()]
  const askDays = new Set(settings.ask_days || [])
  if (!forcedDate && !askDays.has(targetDow)) {
    return res.status(200).json({ ok: true, skipped: 'target_day_not_ask', target: period.to, dow: targetDow })
  }

  // Активные риелторы
  const { data: realtors } = await supabase
    .from('profiles')
    .select('id, name, telegram_user_id')
    .eq('submits_reports', true)
    .eq('is_active', true)
    .order('name')

  const totalCount = realtors?.length || 0

  // Отчёты в периоде (включая отсутствия)
  const metricsList = (settings.metrics || []).filter((m) => m.show_in_summary)
  // Не все метрики с type='shows' имеют колонку _objects (напр. shows_clients хранит только _count).
  // Фильтруем по DAILY_REPORT_COLUMNS, иначе PostgREST возвращает 42703 → вся выборка обнуляется.
  const allowed = new Set(DAILY_REPORT_COLUMNS)
  const dbCols = metricsList
    .flatMap((m) => (m.type === 'shows' ? [`${m.key}_count`, `${m.key}_objects`] : [m.key]))
    .filter((c) => allowed.has(c))
  const cols = ['user_id', 'absence_type', 'date_from', 'date_to', ...new Set(dbCols)].join(', ')

  const { data: reports, error: reportsErr } = await supabase
    .from('daily_reports')
    .select(cols)
    .lte('date_from', period.to)
    .gte('date_to', period.from)
    .eq('is_valid', true)
  if (reportsErr) {
    // Лучше упасть, чем отправить в чат «0 из N» с ложным обвинением всех бойцов.
    console.error('[reports-summary] daily_reports select error', reportsErr, { cols })
    return res.status(500).json({ error: 'reports_select_failed', message: reportsErr.message })
  }

  const submitted = new Set()
  const absent = [] // { user_id, type, from, to }
  const totals = Object.fromEntries(metricsList.map((m) => [m.key, m.type === 'shows' ? { count: 0, objects: 0 } : 0]))

  for (const r of reports || []) {
    if (r.absence_type) {
      // Абсентизм — в отдельный список, но отчёт считается сданным
      // (риелтор прислал сообщение), а метрики из текста (напр. «Вал 75 000»
      // при больничном) суммируются в общие totals.
      absent.push({ user_id: r.user_id, type: r.absence_type, from: r.date_from, to: r.date_to })
    }
    submitted.add(r.user_id)
    for (const m of metricsList) {
      if (m.type === 'shows') {
        totals[m.key].count += Number(r[`${m.key}_count`] || 0)
        totals[m.key].objects += Number(r[`${m.key}_objects`] || 0)
      } else {
        totals[m.key] += Number(r[m.key] || 0)
      }
    }
  }

  const realtorById = Object.fromEntries((realtors || []).map((r) => [r.id, r]))
  const absentWithNames = absent
    .map((a) => ({ ...a, name: realtorById[a.user_id]?.name }))
    .filter((a) => a.name)
  const absentIds = new Set(absent.map((a) => a.user_id))
  const notSubmitted = (realtors || [])
    .filter((r) => !submitted.has(r.id) && !absentIds.has(r.id))
    .map((r) => r.name)
    .filter(Boolean)

  const header = period.isBatch
    ? `📊 Сводка за ${formatRuPeriodCompact(period.from, period.to)}`
    : `📊 Сводка за ${formatRu(period.to)}`

  const lines = [header, `Отчитались: ${submitted.size} из ${totalCount}`, '']
  for (const m of metricsList) {
    if (m.type === 'shows') {
      lines.push(`${m.label} — ${totals[m.key].count}${totals[m.key].objects ? ` (${totals[m.key].objects} об.)` : ''}`)
    } else if (m.type === 'money') {
      lines.push(`${m.label} — ${fmtMoney(totals[m.key])} ₽`)
    } else {
      lines.push(`${m.label} — ${totals[m.key]}`)
    }
  }
  if (absentWithNames.length) {
    lines.push('')
    lines.push(
      'Отсутствуют: ' +
        absentWithNames.map((a) => `${a.name} (${ABSENCE_LABEL[a.type] || a.type})`).join(', ')
    )
  }
  if (notSubmitted.length) {
    lines.push('')
    lines.push('Не прислали: ' + notSubmitted.join(', '))
  }

  const text = lines.join('\n')

  if (dry) {
    return res.status(200).json({ ok: true, dry: true, period, text })
  }

  const tgRes = await sendToGroup(text)
  return res.status(200).json({
    ok: tgRes?.ok === true,
    period,
    submitted_count: submitted.size,
    absent: absentWithNames.map((a) => a.name),
    missing: notSubmitted,
    telegram: tgRes,
  })
}
