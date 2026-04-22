/**
 * POST   /api/admin/reports/unlock-day?date=YYYY-MM-DD — создаёт/обновляет override.
 * DELETE /api/admin/reports/unlock-day?date=YYYY-MM-DD — снимает override.
 * GET    /api/admin/reports/unlock-day?from=...&to=... — список overrides в диапазоне.
 *
 * Override снимает для указанного дня блокировку «после 09:30 правки не принимаем».
 * Пока запись есть — бот принимает новые/изменённые отчёты риелторов за эту дату.
 */

import { getSupabaseAdmin } from '../../../../lib/supabaseServer'

async function requireAdmin(req, supabase) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, role')
    .eq('id', user.id)
    .single()
  if (!profile) return null
  if (profile.role !== 'admin' && profile.role !== 'manager') return null
  return profile
}

export default async function handler(req, res) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

  const caller = await requireAdmin(req, supabase)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  if (req.method === 'GET') {
    const from = String(req.query.from || '')
    const to = String(req.query.to || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'from + to обязательны' })
    }
    const { data, error } = await supabase
      .from('report_day_overrides')
      .select('date, unlocked_by, unlocked_at')
      .gte('date', from)
      .lte('date', to)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ overrides: data || [] })
  }

  const date = String(req.query.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date=YYYY-MM-DD обязателен' })
  }

  if (req.method === 'POST') {
    const { error } = await supabase
      .from('report_day_overrides')
      .upsert(
        { date, unlocked_by: caller.id, unlocked_at: new Date().toISOString() },
        { onConflict: 'date' }
      )
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, date })
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('report_day_overrides')
      .delete()
      .eq('date', date)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, date })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
