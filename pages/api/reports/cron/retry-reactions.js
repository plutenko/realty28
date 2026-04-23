import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { setMessageReaction } from '../../../../lib/reportsTelegram'

/**
 * Дожимает реакции, которые не поставились с первой попытки из webhook'а
 * (контейнер Timeweb периодически ловит Connect Timeout к api.telegram.org).
 *
 * Источник строк: таблица pending_reactions (миграция 052). Стратегия:
 * берём пачку (limit 50) с `next_try_at <= now() AND attempts < 10`,
 * пробуем setMessageReaction, на успехе — удаляем запись; на неуспехе —
 * инкрементим attempts и двигаем next_try_at с экспоненциальным бэк-оффом
 * (1,2,5,10,20,40,60,60,60,60 минут).
 *
 * Аутентификация: x-cron-secret или ?secret=CRON_SECRET. Предполагается
 * регулярный триггер снаружи (cron-job.org, ~раз в минуту).
 */
const BACKOFF_MIN = [1, 2, 5, 10, 20, 40, 60, 60, 60, 60]

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  const secret = req.headers['x-cron-secret'] || req.query.secret
  const expected = process.env.CRON_SECRET
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'no supabase' })

  const nowIso = new Date().toISOString()
  const { data: rows, error } = await supabase
    .from('pending_reactions')
    .select('id, chat_id, message_id, emoji, attempts')
    .lte('next_try_at', nowIso)
    .lt('attempts', 10)
    .order('next_try_at')
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })

  const out = { processed: 0, ok: 0, retry: 0, gaveup: 0, skipped: 0 }
  for (const r of rows || []) {
    out.processed += 1
    let tgResp
    try {
      tgResp = await setMessageReaction(r.chat_id, r.message_id, r.emoji)
    } catch (e) {
      tgResp = { ok: false, error: String(e?.message || e) }
    }
    if (tgResp?.ok) {
      await supabase.from('pending_reactions').delete().eq('id', r.id)
      out.ok += 1
      continue
    }
    const code = tgResp?.error_code
    const isBusinessErr = code && code >= 400 && code < 500 && code !== 429
    const nextAttempts = r.attempts + 1
    if (isBusinessErr || nextAttempts >= 10) {
      // Бизнес-ошибка или исчерпан лимит — поднимем attempts до 10, чтобы не брать снова.
      await supabase
        .from('pending_reactions')
        .update({
          attempts: 10,
          last_error: String(tgResp?.description || tgResp?.error || 'unknown').slice(0, 500),
        })
        .eq('id', r.id)
      out.gaveup += 1
      continue
    }
    const delayMin = BACKOFF_MIN[Math.min(nextAttempts - 1, BACKOFF_MIN.length - 1)]
    const nextIso = new Date(Date.now() + delayMin * 60 * 1000).toISOString()
    await supabase
      .from('pending_reactions')
      .update({
        attempts: nextAttempts,
        next_try_at: nextIso,
        last_error: String(tgResp?.description || tgResp?.error || 'timeout').slice(0, 500),
      })
      .eq('id', r.id)
    out.retry += 1
  }

  return res.status(200).json({ ok: true, ...out })
}
