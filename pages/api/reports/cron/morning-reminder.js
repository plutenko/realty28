import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { getReportsSettings, fillTemplate } from '../../../../lib/reportsSettings'
import { sendToGroup, formatMention } from '../../../../lib/reportsTelegram'
import {
  localParts,
  computeSummaryPeriod,
  formatRu,
  isHoliday,
} from '../../../../lib/reportsCron'

/**
 * Утреннее "last-call" напоминание за 30 мин до сводки.
 * Тегает тех, кто не прислал вчерашний отчёт и не в отсутствии.
 * Период — тот же, что у утренней сводки (вчера или Пт-Вс в Пн).
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
    return res.status(200).json({ ok: true, skipped: 'holiday', date: nowLocal.dateIso })
  }

  const period = computeSummaryPeriod(nowLocal, settings)

  // Напоминание актуально только если "вчера" было ask_day
  const DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const [py, pm, pd] = period.to.split('-').map(Number)
  const targetDow = DOW_NAMES[new Date(Date.UTC(py, pm - 1, pd)).getUTCDay()]
  const askDays = new Set(settings.ask_days || [])
  if (!askDays.has(targetDow)) {
    return res.status(200).json({ ok: true, skipped: 'target_day_not_ask', target: period.to, dow: targetDow })
  }

  const { data: realtors } = await supabase
    .from('profiles')
    .select('id, name, telegram_user_id')
    .eq('submits_reports', true)
    .eq('is_active', true)

  if (!realtors?.length) {
    return res.status(200).json({ ok: true, skipped: 'no_realtors' })
  }

  const { data: reports } = await supabase
    .from('daily_reports')
    .select('user_id, date_from, date_to, absence_type')
    .lte('date_from', period.to)
    .gte('date_to', period.from)
    .eq('is_valid', true)

  const submittedIds = new Set()
  const absentIds = new Set()
  for (const r of reports || []) {
    if (r.absence_type) absentIds.add(r.user_id)
    else submittedIds.add(r.user_id)
  }

  const missing = realtors.filter((r) => !submittedIds.has(r.id) && !absentIds.has(r.id))
  if (missing.length === 0) {
    return res.status(200).json({ ok: true, skipped: 'all_submitted' })
  }

  const tgIds = missing.map((r) => r.telegram_user_id).filter(Boolean)
  const { data: members } = tgIds.length
    ? await supabase.from('telegram_chat_members').select('telegram_user_id, username, first_name, last_name').in('telegram_user_id', tgIds)
    : { data: [] }
  const byTg = Object.fromEntries((members || []).map((m) => [m.telegram_user_id, m]))

  const mentions = missing.map((r) => {
    const m = r.telegram_user_id ? byTg[r.telegram_user_id] : null
    if (m) {
      return formatMention(
        {
          telegram_user_id: r.telegram_user_id,
          username: m.username,
          first_name: m.first_name || r.name,
          last_name: m.last_name,
        },
        settings.mention_mode
      )
    }
    return r.name || 'риелтор'
  })

  const tmpl = period.isBatch
    ? settings.messages?.morning_reminder_batch ||
      '🚨 Тридцать минут до сводки. Рапорты за {dates} ещё не у Старшины: {users}. Пошевеливаемся.'
    : settings.messages?.morning_reminder_weekday ||
      '🚨 Тридцать минут до сводки за {date}. Не сдали: {users}. Последний шанс, бойцы.'

  const text = fillTemplate(tmpl, {
    date: formatRu(period.to),
    dates: `${formatRu(period.from)} – ${formatRu(period.to)}`,
    users: mentions.join(', '),
  })

  if (dry) {
    return res.status(200).json({
      ok: true,
      dry: true,
      period,
      missing: missing.map((r) => r.name),
      text,
    })
  }

  const tgRes = await sendToGroup(text, { parseMode: 'HTML' })
  return res.status(200).json({
    ok: tgRes?.ok === true,
    sent: missing.map((r) => r.name),
    telegram: tgRes,
  })
}
