import { getSupabaseAdmin } from '../../../lib/supabaseServer'

async function requireManager(req) {
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
  return profile?.role === 'manager' || profile?.role === 'admin' ? user : null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = getSupabaseAdmin()
  const caller = await requireManager(req)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  // Все риелторы
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('id, name, email, role')
    .eq('role', 'realtor')
    .order('name', { ascending: true })

  if (pErr) return res.status(500).json({ error: pErr.message })

  // Подборки для каждого риелтора
  const realtorIds = (profiles ?? []).map(p => p.id)
  let collections = []
  if (realtorIds.length > 0) {
    const { data: cols } = await supabase
      .from('collections')
      .select('id, token, title, client_name, views_count, created_at, created_by')
      .in('created_by', realtorIds)
      .order('created_at', { ascending: false })
    collections = cols ?? []
  }

  // Группируем подборки по риелтору
  const colsByRealtor = {}
  for (const col of collections) {
    const rid = col.created_by
    if (!colsByRealtor[rid]) colsByRealtor[rid] = []
    colsByRealtor[rid].push(col)
  }

  const result = (profiles ?? []).map(p => ({
    ...p,
    collections: colsByRealtor[p.id] ?? [],
  }))

  return res.status(200).json(result)
}
