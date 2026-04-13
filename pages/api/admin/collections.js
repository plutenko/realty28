import { getSupabaseAdmin } from '../../../lib/supabaseServer'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = getSupabaseAdmin()

  // Verify caller is admin
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'No token' })
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  // Load collections
  const { data: cols } = await supabase
    .from('collections')
    .select('*')
    .order('created_at', { ascending: false })

  // Load profiles for creators
  const creatorIds = [...new Set((cols ?? []).map(c => c.created_by).filter(Boolean))]
  const profiles = {}
  if (creatorIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, name, email, role')
      .in('id', creatorIds)
    for (const p of (profs ?? [])) profiles[p.id] = p
  }

  return res.status(200).json({ collections: cols ?? [], profiles })
}
