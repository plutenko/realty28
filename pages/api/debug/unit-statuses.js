import { getSupabaseAdmin } from '../../../lib/supabaseServer'

export default async function handler(req, res) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'No supabase' })

  const buildingId = req.query.building_id
  if (!buildingId) return res.status(400).json({ error: 'building_id required' })

  const { data, error } = await supabase
    .from('units')
    .select('id, number, floor, status, source_id, last_seen_at')
    .eq('building_id', buildingId)
    .order('number')
    .limit(500)

  if (error) return res.status(500).json({ error: error.message })

  const statusCounts = {}
  for (const u of data || []) {
    statusCounts[u.status] = (statusCounts[u.status] || 0) + 1
  }

  return res.status(200).json({
    total: data?.length || 0,
    statusCounts,
    sample: (data || []).slice(0, 10),
  })
}
