import { getSupabaseAdmin } from '../../../lib/supabaseServer'

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

/**
 * GET /api/manager/crm-realtor-counts
 * Возвращает массив { id, new_count, in_work_count, add_to_base_count }
 * по всем риелторам. Используется в дашборде для отображения загрузки.
 */
export default async function handler(req, res) {
  const caller = await requireAdminOrManager(req)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('leads')
    .select('assigned_user_id, status')
    .not('assigned_user_id', 'is', null)
    .in('status', ['new', 'add_to_base', 'in_work'])

  if (error) return res.status(500).json({ error: error.message })

  const counts = {}
  for (const l of data || []) {
    const uid = l.assigned_user_id
    if (!counts[uid]) counts[uid] = { id: uid, new_count: 0, add_to_base_count: 0, in_work_count: 0 }
    if (l.status === 'new') counts[uid].new_count++
    else if (l.status === 'add_to_base') counts[uid].add_to_base_count++
    else if (l.status === 'in_work') counts[uid].in_work_count++
  }

  return res.status(200).json(Object.values(counts))
}
