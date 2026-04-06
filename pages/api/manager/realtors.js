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

  // Все риелторы
  const { data: realtors, error: pErr } = await supabase
    .from('profiles')
    .select('id, name, email, role')
    .eq('role', 'realtor')
    .order('name', { ascending: true })
  if (pErr) return res.status(500).json({ error: pErr.message })

  // Подборки риелторов
  const realtorIds = (realtors ?? []).map(p => p.id)
  let collections = []
  if (realtorIds.length > 0) {
    const { data: cols } = await supabase
      .from('collections')
      .select('id, token, title, client_name, views_count, created_at, created_by')
      .in('created_by', realtorIds)
      .order('created_at', { ascending: false })
    collections = cols ?? []
  }

  const colsByRealtor = {}
  for (const col of collections) {
    const rid = col.created_by
    if (!colsByRealtor[rid]) colsByRealtor[rid] = []
    colsByRealtor[rid].push(col)
  }

  const realtorList = (realtors ?? []).map(p => ({
    ...p,
    collections: colsByRealtor[p.id] ?? [],
  }))

  // Для admin — ещё список менеджеров
  let managers = []
  if (caller.role === 'admin') {
    const { data: mgrs } = await supabase
      .from('profiles')
      .select('id, name, email')
      .eq('role', 'manager')
      .order('name', { ascending: true })
    managers = mgrs ?? []
  }

  return res.status(200).json({ realtors: realtorList, managers })
}
