import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { getReportsSettings } from '../../../../lib/reportsSettings'
import { sendToGroup } from '../../../../lib/reportsTelegram'
import { localParts, isHoliday } from '../../../../lib/reportsCron'

/**
 * Пятничное 15:00 Якутск — информационное в группу: рапорты за Пт/Сб/Вс
 * сдаются одним батчем в воскресенье вечером. Без тегов. Дубликат защиты —
 * если крон вдруг сработал не в пятницу, ничего не шлём.
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

  if (nowLocal.dow !== 'fri') {
    return res.status(200).json({ ok: true, skipped: 'not_friday', dow: nowLocal.dow })
  }
  if (isHoliday(nowLocal.dateIso, settings)) {
    return res.status(200).json({ ok: true, skipped: 'holiday', date: nowLocal.dateIso })
  }

  const text =
    settings.messages?.friday_batch_notice ||
    '📅 Пятница. Рапорты за Пт+Сб+Вс — одним сообщением в воскресенье вечером.'

  if (dry) {
    return res.status(200).json({ ok: true, dry: true, text })
  }

  const tgRes = await sendToGroup(text, { parseMode: 'HTML' })
  return res.status(200).json({ ok: tgRes?.ok === true, telegram: tgRes, text })
}
