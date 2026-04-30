import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { handleCallbackQuery } from '../telegram-webhook'

/**
 * Дожимает Telegram-callback'и, которые не успели обработаться inline в webhook'е
 * (например контейнер Timeweb получил SIGTERM в окне обработки). Источник —
 * таблица tg_callback_queue (миграция 063).
 *
 * Стратегия:
 * - Берём пачку (limit 50) с status='queued' AND next_retry_at <= now()
 * - Для каждой: вытаскиваем JSON callback из payload, передаём в handleCallbackQuery
 * - На успехе — помечаем status='done'
 * - На ошибке — increment attempts, ставим next_retry_at по бэк-оффу
 *   (30,60,120,300,600,1800,1800,1800,1800,1800 сек). После 10 попыток — 'failed'.
 *
 * Аутентификация: x-cron-secret или ?secret=CRON_SECRET (как у retry-reactions).
 * Триггер снаружи: cron-job.org каждую минуту.
 */
const RETRY_BACKOFF_SEC = [30, 60, 120, 300, 600, 1800, 1800, 1800, 1800, 1800]
const MAX_ATTEMPTS = 10

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  const secret = req.headers['x-cron-secret'] || req.query.secret
  const expected = process.env.CRON_SECRET
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'no supabase' })

  const nowIso = new Date().toISOString()
  const { data: rows, error } = await supabase
    .from('tg_callback_queue')
    .select('cq_id, payload, attempts')
    .eq('status', 'queued')
    .lte('next_retry_at', nowIso)
    .order('next_retry_at')
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })

  const out = { processed: 0, ok: 0, retry: 0, gaveup: 0 }
  for (const row of rows || []) {
    out.processed += 1
    let success = false
    let errMsg = null
    try {
      await handleCallbackQuery(supabase, row.payload)
      success = true
    } catch (e) {
      errMsg = String(e?.message || e).slice(0, 500)
    }

    if (success) {
      await supabase
        .from('tg_callback_queue')
        .update({ status: 'done', processed_at: nowIso })
        .eq('cq_id', row.cq_id)
      out.ok += 1
      continue
    }

    const nextAttempts = (row.attempts || 0) + 1
    if (nextAttempts >= MAX_ATTEMPTS) {
      await supabase
        .from('tg_callback_queue')
        .update({ status: 'failed', attempts: nextAttempts, last_error: errMsg })
        .eq('cq_id', row.cq_id)
      out.gaveup += 1
    } else {
      const backoffSec = RETRY_BACKOFF_SEC[Math.min(nextAttempts, RETRY_BACKOFF_SEC.length - 1)]
      await supabase
        .from('tg_callback_queue')
        .update({
          attempts: nextAttempts,
          last_error: errMsg,
          next_retry_at: new Date(Date.now() + backoffSec * 1000).toISOString(),
        })
        .eq('cq_id', row.cq_id)
      out.retry += 1
    }
  }

  return res.status(200).json({ ok: true, ...out })
}
