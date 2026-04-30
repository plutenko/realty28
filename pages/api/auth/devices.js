import { getSupabaseAdmin } from '../../../lib/supabaseServer'

/**
 * GET    /api/auth/devices       — список всех устройств (только admin/manager)
 * DELETE /api/auth/devices?id=xx — удалить устройство (только admin/manager)
 */
export default async function handler(req, res) {
  const authToken = req.headers.authorization?.replace('Bearer ', '')
  if (!authToken) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Server error' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(authToken)
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin' && profile?.role !== 'manager') {
    return res.status(403).json({ error: 'Только админ или менеджер' })
  }

  if (req.method === 'GET') {
    const { data: devices, error } = await supabase
      .from('user_devices')
      .select('id, user_id, label, created_at, last_used_at, last_approved_at')
      .order('last_used_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })

    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('id, name, email, role, created_at')
      .order('name')
    const profilesById = Object.fromEntries((allProfiles ?? []).map(p => [p.id, p]))

    const enriched = (devices ?? []).map(d => ({
      ...d,
      user_name: profilesById[d.user_id]?.name || null,
      user_email: profilesById[d.user_id]?.email || null,
      user_role: profilesById[d.user_id]?.role || null,
    }))

    const { data: pendings } = await supabase
      .from('pending_logins')
      .select('user_id, status, device_label, created_at, expires_at, approved_at')
      .order('created_at', { ascending: false })

    return res.status(200).json({
      devices: enriched,
      pendingLogins: pendings ?? [],
      profiles: allProfiles ?? [],
    })
  }

  if (req.method === 'DELETE') {
    const id = String(req.query.id || '').trim()
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await supabase.from('user_devices').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
