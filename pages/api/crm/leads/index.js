import { getSupabaseAdmin } from '../../../../lib/supabaseServer'

async function requireCrmRealtor(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const supabase = getSupabaseAdmin()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, crm_enabled, is_active')
    .eq('id', user.id)
    .single()
  if (!profile || profile.is_active === false || !profile.crm_enabled) return null
  return { user, profile }
}

export default async function handler(req, res) {
  const caller = await requireCrmRealtor(req)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()

  if (req.method === 'GET') {
    const { status, period } = req.query
    let q = supabase
      .from('leads')
      .select(`
        id, status, name, phone, phone_normalized, email, rooms, budget,
        assigned_user_id, assigned_at, reaction_seconds, close_reason, closed_at,
        external_base_id, external_base_id_seller, lead_kind,
        created_at, updated_at, source_id,
        answers,
        lead_sources(kind)
      `)
      .eq('assigned_user_id', caller.user.id)
      .order('created_at', { ascending: false })
      .limit(300)

    if (status === 'active') q = q.in('status', ['new', 'add_to_base', 'in_work'])
    else if (status === 'closed') q = q.in('status', ['not_lead', 'deal_done', 'failed'])
    else if (status && status !== 'all') q = q.eq('status', status)

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

export { requireCrmRealtor }
