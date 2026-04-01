import { getSupabaseAdmin } from '../../../lib/supabaseServer'
import { collectUnitsFromProfitbaseSource } from '../../../lib/profitbaseSourceSync'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const sourceId = String(req.query.sourceId || '').trim()
  const houseId = String(req.query.houseId || '').trim()
  let source = null

  if (sourceId) {
    const supabase = getSupabaseAdmin()
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase admin is not configured' })
    }
    const { data, error: srcErr } = await supabase
      .from('sources')
      .select('id, type, url, building_id')
      .eq('id', sourceId)
      .maybeSingle()
    if (srcErr) return res.status(500).json({ error: srcErr.message })
    if (!data) return res.status(404).json({ error: 'Source not found' })
    source = data
  } else if (houseId) {
    source = {
      id: 'debug-source',
      type: 'profitbase',
      url: houseId,
      building_id: req.query.buildingId ? String(req.query.buildingId) : null,
    }
  } else {
    return res.status(400).json({ error: 'sourceId or houseId is required' })
  }

  const collected = await collectUnitsFromProfitbaseSource(source)
  if (collected.error) {
    return res.status(500).json({ error: collected.error })
  }

  const units = collected.units || []
  const byFloorEntrance = {}
  for (const u of units) {
    const floor = Number(u.floor) || 0
    const entrance = Number(u.entrance) || 1
    const key = `${floor}:${entrance}`
    if (!byFloorEntrance[key]) byFloorEntrance[key] = []
    byFloorEntrance[key].push({
      number: u.number,
      position: u.position,
      status: u.status,
      external_id: u.external_id,
    })
  }
  for (const key of Object.keys(byFloorEntrance)) {
    byFloorEntrance[key].sort((a, b) => Number(a.position) - Number(b.position))
  }

  return res.status(200).json({
    source: { id: source.id, building_id: source.building_id, url: source.url },
    meta: collected.meta || null,
    unitsCount: units.length,
    byFloorEntrance,
  })
}

