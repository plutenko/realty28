import { getSupabaseAdmin } from '../../lib/supabaseServer'
import { upsertImportedUnits } from '../../lib/upsertImportedUnits'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end()
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase admin is not configured' })
  }

  const units = req.body
  if (!Array.isArray(units)) {
    return res.status(400).json({ error: 'Expected JSON array body' })
  }

  try {
    const { count } = await upsertImportedUnits(supabase, units)
    return res.status(200).json({ success: true, count })
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Import failed' })
  }
}
