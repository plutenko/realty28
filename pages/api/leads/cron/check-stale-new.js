import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { sendTelegramMessage } from '../../../../lib/telegram'

/**
 * Раз в сутки.
 * Ищет лиды status='new' AND assigned_user_id IS NOT NULL, у которых
 * assigned_at старше 3 суток и по которым ещё не отправлялось stale-warning
 * за последние 5 дней. Шлёт уведомление риелтору + руководителю/админу.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end()

  const secret = req.headers['x-cron-secret'] || req.query.secret
  const expected = process.env.CRON_SECRET
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'no supabase' })

  const threshold = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  const { data: candidates, error } = await supabase
    .from('leads')
    .select(`
      id, name, phone, assigned_at, assigned_user_id,
      lead_sources(name, kind),
      profiles:assigned_user_id(id, name, email, telegram_chat_id)
    `)
    .eq('status', 'new')
    .not('assigned_user_id', 'is', null)
    .lt('assigned_at', threshold)
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })
  if (!candidates || candidates.length === 0) {
    return res.status(200).json({ ok: true, warned: 0 })
  }

  const since = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
  const leadIds = candidates.map(l => l.id)
  const { data: recent } = await supabase
    .from('lead_events')
    .select('lead_id')
    .in('lead_id', leadIds)
    .eq('event_type', 'stale_new_warning_3d')
    .gte('created_at', since)
  const alreadyWarned = new Set((recent || []).map(e => e.lead_id))

  const pending = candidates.filter(l => !alreadyWarned.has(l.id))
  if (pending.length === 0) {
    return res.status(200).json({ ok: true, warned: 0, seen: candidates.length })
  }

  const { data: managers } = await supabase
    .from('profiles')
    .select('telegram_chat_id')
    .in('role', ['admin', 'manager'])
    .not('telegram_chat_id', 'is', null)

  let warned = 0
  for (const lead of pending) {
    const days = Math.floor((Date.now() - new Date(lead.assigned_at).getTime()) / (24 * 60 * 60 * 1000))
    const sourceName = lead.lead_sources?.name || lead.lead_sources?.kind || 'источник'
    const realtorName = lead.profiles?.name || lead.profiles?.email || 'риелтор'

    // Риелтору — напоминание
    if (lead.profiles?.telegram_chat_id) {
      const txt =
        `⏰ <b>Лид застрял в статусе «Новый»</b>\n\n` +
        `Клиент: ${escapeHtml(lead.name || '—')} (${escapeHtml(lead.phone || '—')})\n` +
        `Источник: ${escapeHtml(sourceName)}\n` +
        `Без движения уже ${days} дн.\n\n` +
        `Если клиент ещё актуален — позвони и переведи в «Внести в базу».\n` +
        `Если нет — закрой как «Не лид» с причиной.`
      try { await sendTelegramMessage(lead.profiles.telegram_chat_id, txt) } catch {}
    }

    // Руководству — копия
    const mgrTxt =
      `⏰ <b>Лид без движения 3+ дня</b>\n\n` +
      `Клиент: ${escapeHtml(lead.name || '—')} (${escapeHtml(lead.phone || '—')})\n` +
      `Риелтор: ${escapeHtml(realtorName)}\n` +
      `Источник: ${escapeHtml(sourceName)}\n` +
      `В статусе «Новый» уже ${days} дн.`
    for (const m of managers || []) {
      if (!m.telegram_chat_id) continue
      try { await sendTelegramMessage(m.telegram_chat_id, mgrTxt) } catch {}
    }

    await supabase.from('lead_events').insert({
      lead_id: lead.id,
      event_type: 'stale_new_warning_3d',
      meta: { days_assigned: days },
    })
    warned++
  }

  return res.status(200).json({ ok: true, warned })
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
