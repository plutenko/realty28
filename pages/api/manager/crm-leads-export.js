import { getSupabaseAdmin } from '../../../lib/supabaseServer'

async function requireAdminOrManager(req) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token
  if (!token) return null
  const supabase = getSupabaseAdmin()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!['admin', 'manager'].includes(profile?.role)) return null
  return { user, role: profile.role }
}

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export default async function handler(req, res) {
  const caller = await requireAdminOrManager(req)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()
  const { period = 'month' } = req.query

  let sinceIso = null
  if (period === 'today') {
    const d = new Date(); d.setHours(0, 0, 0, 0); sinceIso = d.toISOString()
  } else if (period === 'week') {
    const d = new Date(); d.setDate(d.getDate() - 7); sinceIso = d.toISOString()
  } else if (period === 'month') {
    const d = new Date(); d.setDate(d.getDate() - 30); sinceIso = d.toISOString()
  }

  let q = supabase
    .from('leads')
    .select(`
      id, status, name, phone, phone_normalized, email, rooms, budget,
      created_at, assigned_at, reaction_seconds, closed_at, close_reason, external_base_id,
      source_id, lead_sources(name),
      assigned_user_id, profiles:assigned_user_id(name, email)
    `)
    .order('created_at', { ascending: false })
  if (sinceIso) q = q.gte('created_at', sinceIso)
  const { data, error } = await q
  if (error) return res.status(500).json({ error: error.message })

  const STATUS_LABEL = {
    new: 'Новый', add_to_base: 'Внести в базу', in_work: 'В работе',
    deal_done: 'Сделка', not_lead: 'Не лид', failed: 'Срыв',
  }

  const header = [
    'ID', 'Статус', 'Имя', 'Телефон', 'Email', 'Комнат', 'Бюджет',
    'Источник', 'Риелтор', 'Создан', 'Взят', 'Реакция (сек)',
    'Закрыт', 'Причина закрытия', 'ID в базе агентства',
  ].join(';')

  const rows = (data || []).map(l => [
    l.id,
    STATUS_LABEL[l.status] || l.status,
    l.name,
    l.phone,
    l.email,
    l.rooms,
    l.budget,
    l.lead_sources?.name || '',
    l.profiles?.name || l.profiles?.email || '',
    l.created_at ? new Date(l.created_at).toLocaleString('ru-RU') : '',
    l.assigned_at ? new Date(l.assigned_at).toLocaleString('ru-RU') : '',
    l.reaction_seconds ?? '',
    l.closed_at ? new Date(l.closed_at).toLocaleString('ru-RU') : '',
    l.close_reason,
    l.external_base_id,
  ].map(csvEscape).join(';'))

  const csv = '﻿' + [header, ...rows].join('\n')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="leads_${period}_${new Date().toISOString().slice(0, 10)}.csv"`)
  return res.status(200).send(csv)
}
