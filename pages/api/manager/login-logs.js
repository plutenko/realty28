import { getSupabaseAdmin } from '../../../lib/supabaseServer'

async function requireManagerOrAdmin(req) {
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
  return ['manager', 'admin'].includes(profile?.role) ? { user, role: profile.role } : null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = getSupabaseAdmin()
  const caller = await requireManagerOrAdmin(req)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  // Справочник пользователей
  const { data: users } = await supabase
    .from('profiles')
    .select('id, name, email, role')

  const userMap = {}
  for (const u of (users ?? [])) userMap[u.id] = u

  // Последние 300 записей журнала
  const { data: logs, error: logsErr } = await supabase
    .from('login_logs')
    .select('id, user_id, ip_address, browser, os_name, created_at')
    .order('created_at', { ascending: false })
    .limit(300)

  if (logsErr) return res.status(500).json({ error: logsErr.message })

  const result = (logs ?? []).map(l => ({
    ...l,
    userName:  userMap[l.user_id]?.name  || '—',
    userEmail: userMap[l.user_id]?.email || '—',
    userRole:  userMap[l.user_id]?.role  || '—',
  }))

  return res.status(200).json({ logs: result })
}
