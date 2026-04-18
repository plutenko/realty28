import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { getReportsSettings } from '../../../../lib/reportsSettings'
import { sendToGroup } from '../../../../lib/reportsTelegram'
import {
  localParts,
  computeSummaryPeriod,
  formatRu,
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

  if (isHoliday(nowLocal.dateIso, settings)) {
    return res.status(200).json({ ok: true, skipped: 'holiday' })
  }

  const period = computeSummaryPeriod(nowLocal, settings)

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
  const dbCols = metricsList.flatMap((m) => {
    if (m.type === 'shows') return [`${m.key}_count`, `${m.key}_objects`]
    return [m.key]
  })
  const cols = ['user_id', 'absence_type', 'date_from', 'date_to', ...new Set(dbCols)].join(', ')

  const { data: reports } = await supabase
    .from('daily_reports')
    .select(cols)
    .lte('date_from', period.to)
    .gte('date_to', period.from)
    .eq('is_valid', true)

  const submitted = new Set()
  const absent = [] // { user_id, type, from, to }
  const totals = Object.fromEntries(metricsList.map((m) => [m.key, m.type === 'shows' ? { count: 0, objects: 0 } : 0]))

  for (const r of reports || []) {
    if (r.absence_type) {
      absent.push({ user_id: r.user_id, type: r.absence_type, from: r.date_from, to: r.date_to })
      continue
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
    ? `📊 Сводка за ${formatRu(period.from)} – ${formatRu(period.to)}`
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
