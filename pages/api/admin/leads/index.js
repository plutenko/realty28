import { getSupabaseAdmin } from '../../../../lib/supabaseServer'

const ACTIVE_STATUSES = ['new', 'add_to_base', 'in_work']
const TERMINAL_STATUSES = ['not_lead', 'deal_done', 'failed']

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
    const { status, source_id, assigned, period } = req.query
    let q = supabase
      .from('leads')
      .select(`
        id, status, name, phone, phone_normalized, email, rooms, budget, messenger,
        assigned_user_id, assigned_at, reaction_seconds, close_reason, closed_at,
        external_base_id, external_base_id_seller, lead_kind,
        created_at, updated_at, source_id,
        answers, utm,
        lead_sources(name, kind),
        profiles:assigned_user_id(id, name, email)
      `)
      .order('created_at', { ascending: false })
      .limit(500)

    if (status === 'active') q = q.in('status', ACTIVE_STATUSES)
    else if (status === 'closed') q = q.in('status', TERMINAL_STATUSES)
    else if (status && status !== 'all') q = q.eq('status', status)

    if (source_id && source_id !== 'all') q = q.eq('source_id', source_id)
    if (assigned === 'none') q = q.is('assigned_user_id', null)
    else if (assigned && assigned !== 'all') q = q.eq('assigned_user_id', assigned)

    if (period === 'today') {
      const today = new Date(); today.setHours(0, 0, 0, 0)
      q = q.gte('created_at', today.toISOString())
    } else if (period === 'week') {
      const d = new Date(); d.setDate(d.getDate() - 7)
      q = q.gte('created_at', d.toISOString())
    } else if (period === 'month') {
      const d = new Date(); d.setDate(d.getDate() - 30)
      q = q.gte('created_at', d.toISOString())
    }

    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data || [])
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

export { ACTIVE_STATUSES, TERMINAL_STATUSES, requireAdminOrManager }
