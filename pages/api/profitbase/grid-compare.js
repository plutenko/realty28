import { getSupabaseAdmin } from '../../../lib/supabaseServer'
import { collectUnitsFromProfitbaseSource } from '../../../lib/profitbaseSourceSync'

function packCounts(units) {
  const by = {}
  for (const u of units || []) {
    const floor = Number(u.floor)
    const entrance = Number(u.entrance) || 1
    if (!Number.isFinite(floor)) continue
    const key = `${floor}:${entrance}`
    if (!by[key]) by[key] = { count: 0, positions: [] }
    by[key].count += 1
    by[key].positions.push(Number(u.position))
  }
  for (const k of Object.keys(by)) {
    by[k].positions = by[k].positions
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b)
  }
  return by
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const sourceId = String(req.query.sourceId || req.query.id || '').trim()
  if (!sourceId) {
    return res.status(400).json({ error: 'sourceId is required' })
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase admin is not configured' })
  }

  const { data: source, error: srcErr } = await supabase
    .from('sources')
    .select('*')
    .eq('id', sourceId)
    .maybeSingle()
  if (srcErr) return res.status(500).json({ error: srcErr.message })
  if (!source) return res.status(404).json({ error: 'Source not found' })

  const imported = await collectUnitsFromProfitbaseSource(source)
  if (imported.error) {
    return res.status(500).json({ error: imported.error })
  }

  const { data: dbUnits, error: dbErr } = await supabase
    .from('units')
    .select('id, number, floor, entrance, position, status, external_id, source_id, building_id')
    .eq('building_id', source.building_id)
  if (dbErr) return res.status(500).json({ error: dbErr.message })

  const expectedByExt = new Map(
    (imported.units || []).map((u) => [String(u.external_id || ''), u]).filter(([k]) => k)
  )
  const actualByExt = new Map(
    (dbUnits || []).map((u) => [String(u.external_id || ''), u]).filter(([k]) => k)
  )

  const missingInDb = []
  const mismatched = []
  for (const [ext, ex] of expectedByExt.entries()) {
    const ac = actualByExt.get(ext)
    if (!ac) {
      missingInDb.push(ext)
      continue
    }
    const diff =
      Number(ex.floor) !== Number(ac.floor) ||
      Number(ex.entrance) !== Number(ac.entrance) ||
      Number(ex.position) !== Number(ac.position)
    if (diff) {
      mismatched.push({
        external_id: ext,
        expected: { floor: ex.floor, entrance: ex.entrance, position: ex.position, number: ex.number },
        actual: { floor: ac.floor, entrance: ac.entrance, position: ac.position, number: ac.number },
      })
    }
  }

  const extraInDb = []
  for (const ext of actualByExt.keys()) {
    if (!expectedByExt.has(ext)) extraInDb.push(ext)
  }

  return res.status(200).json({
    source: { id: source.id, name: source.name, building_id: source.building_id, url: source.url },
    expected: {
      count: imported.units?.length || 0,
      meta: imported.meta || null,
      byFloorEntrance: packCounts(imported.units || []),
    },
    actual: {
      count: (dbUnits || []).length,
      byFloorEntrance: packCounts(dbUnits || []),
    },
    diffs: {
      missingInDbCount: missingInDb.length,
      extraInDbCount: extraInDb.length,
      mismatchedCount: mismatched.length,
      missingInDbSample: missingInDb.slice(0, 30),
      extraInDbSample: extraInDb.slice(0, 30),
      mismatchedSample: mismatched.slice(0, 30),
    },
  })
}

