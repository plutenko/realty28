import { getSupabaseAdmin } from '../../../lib/supabaseServer'
import { generateSourceKey } from '../../../lib/leadsCore'

const ALLOWED_KINDS = new Set(['marquiz', 'tilda', 'manual'])

async function requireAdminOrManager(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
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

export default async function handler(req, res) {
  const caller = await requireAdminOrManager(req)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('lead_sources')
      .select('id, kind, name, source_key, is_active, created_at')
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data || [])
  }

  if (req.method === 'POST') {
    const { kind, name } = req.body || {}
    if (!kind || !name) return res.status(400).json({ error: 'kind и name обязательны' })
    if (!ALLOWED_KINDS.has(kind)) return res.status(400).json({ error: 'Неизвестный kind' })

    const source_key = generateSourceKey(kind)
    const { data, error } = await supabase
      .from('lead_sources')
      .insert({ kind, name: String(name).trim(), source_key })
      .select('id, kind, name, source_key, is_active, created_at')
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json(data)
  }

  if (req.method === 'PATCH') {
    const { id, name, is_active } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id обязателен' })
    const updates = { updated_at: new Date().toISOString() }
    if (typeof name === 'string') updates.name = name.trim()
    if (typeof is_active === 'boolean') updates.is_active = is_active
    const { error } = await supabase.from('lead_sources').update(updates).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'DELETE') {
    if (caller.role !== 'admin') return res.status(403).json({ error: 'Только admin' })
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id обязателен' })
    const { error } = await supabase.from('lead_sources').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
