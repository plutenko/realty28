import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { sendTelegramMessage } from '../../../../lib/telegram'

/**
 * Крон раз в минуту.
 * Ищет лиды со статусом new, assigned_user_id=null, старше 5 минут,
 * по которым ещё не отправлялась эскалация — шлёт уведомление
 * админу/руководителю, чтобы он назначил вручную или позвонил клиенту.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end()

  const secret = req.headers['x-cron-secret'] || req.query.secret
  const expected = process.env.CRON_SECRET
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'no supabase' })

  // Порог эскалации (в минутах) берём из crm_settings, дефолт 40.
  const { data: settings } = await supabase
    .from('crm_settings')
    .select('unclaimed_escalation_minutes')
    .eq('id', 1)
    .maybeSingle()
  const minutes = Math.max(1, Number(settings?.unclaimed_escalation_minutes) || 40)
  const threshold = new Date(Date.now() - minutes * 60 * 1000).toISOString()

  // Лиды без риелтора старше 5 мин
  const { data: candidates, error } = await supabase
    .from('leads')
    .select('id, name, phone, created_at, lead_sources(name, kind)')
    .eq('status', 'new')
    .is('assigned_user_id', null)
    .lt('created_at', threshold)
    .order('created_at')
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })
  if (!candidates || candidates.length === 0) {
    return res.status(200).json({ ok: true, escalated: 0 })
  }

  // Исключаем те, по которым уже было событие escalated_unclaimed
  const leadIds = candidates.map(l => l.id)
  const { data: alreadyEscalated } = await supabase
    .from('lead_events')
    .select('lead_id')
    .in('lead_id', leadIds)
    .eq('event_type', 'escalated_unclaimed')
  const escalatedSet = new Set((alreadyEscalated || []).map(e => e.lead_id))

  const pending = candidates.filter(l => !escalatedSet.has(l.id))
  if (pending.length === 0) {
    return res.status(200).json({ ok: true, escalated: 0, seen: candidates.length })
  }

  // Получатели — админ+руководитель с привязанным Домовой
  const { data: managers } = await supabase
    .from('profiles')
    .select('telegram_chat_id')
    .in('role', ['admin', 'manager'])
    .not('telegram_chat_id', 'is', null)

  let sent = 0
  for (const lead of pending) {
    const ageMin = Math.round((Date.now() - new Date(lead.created_at).getTime()) / 60000)
    const sourceName = lead.lead_sources?.name || lead.lead_sources?.kind || 'источник'
    const text =
      `⚠ <b>Заявку никто не взял!</b>\n\n` +
      `Клиент: ${escapeHtml(lead.name || '—')} (${escapeHtml(lead.phone || '—')})\n` +
      `Источник: ${escapeHtml(sourceName)}\n` +
      `Лежит уже ${ageMin} мин (порог ${minutes}).\n\n` +
      `Открой /admin/leads или /manager/leads и назначь вручную, либо позвони клиенту сам.`

    const replyMarkup = {
      inline_keyboard: [[
        { text: '👥 Назначить риелтора', callback_data: `assignlead:${lead.id}` },
      ]],
    }
    const sentTo = []
    for (const m of managers || []) {
      if (!m.telegram_chat_id) continue
      try {
        const resp = await sendTelegramMessage(m.telegram_chat_id, text, { replyMarkup })
        if (resp?.ok && resp?.result?.message_id) {
          sentTo.push({ chat_id: Number(m.telegram_chat_id), message_id: Number(resp.result.message_id) })
        }
      } catch {}
    }

    await supabase.from('lead_events').insert({
      lead_id: lead.id,
      event_type: 'escalated_unclaimed',
      meta: { age_minutes: ageMin, sent_to: sentTo },
    })
    sent++
  }

  return res.status(200).json({ ok: true, escalated: sent })
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
