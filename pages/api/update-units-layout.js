import { getSupabaseAdmin } from '../../lib/supabaseServer'
import { upsertUnitsStrippingUnknownColumns } from '../../lib/supabaseUpsertColumnFallback'

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function ensureUnitId(v) {
  const s = String(v ?? '').trim()
  if (s) return s
  // Для новых квартир генерируем UUID на сервере,
  // иначе INSERT падает на NOT NULL по колонке units.id.
  return crypto.randomUUID()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return json(res, 500, { error: 'Supabase admin is not configured' })
  }

  const { upsert = [], deleteIds = [] } = req.body ?? {}
  if (!Array.isArray(upsert) || !Array.isArray(deleteIds)) {
    return json(res, 400, { error: 'Expected { upsert: [], deleteIds: [] }' })
  }

  try {
    if (deleteIds.length) {
      const ids = deleteIds.map(String).filter(Boolean)
      if (ids.length) {
        const { error } = await supabase.from('units').delete().in('id', ids)
        if (error) throw error
      }
    }

    if (upsert.length) {
      const rows = upsert.map((u) => ({
        id: ensureUnitId(u.id),
        building_id: u.building_id ?? null,
        source_id: u.source_id ?? null,
        external_id: u.external_id ?? null,
        number: u.number ?? null,
        floor: u.floor ?? null,
        entrance: u.entrance ?? null,
        position: u.position ?? null,
        rooms: u.rooms ?? null,
        area: u.area ?? null,
        price: u.price ?? null,
        price_per_meter: u.price_per_meter ?? null,
        status: u.status ?? 'available',
        span_columns: u.span_columns ?? 1,
        span_floors: u.span_floors ?? 1,
        is_combined: Boolean(u.is_combined),
        combined_unit_ids: Array.isArray(u.combined_unit_ids) ? u.combined_unit_ids : [],
        layout_title: u.layout_title ?? null,
        is_commercial: Boolean(u.is_commercial),
        layout_image_url: u.layout_image_url ?? null,
        finish_image_url: u.finish_image_url ?? null,
      }))

      await upsertUnitsStrippingUnknownColumns(supabase, rows, {
        onConflict: 'id',
      })
    }

    return json(res, 200, { ok: true, upserted: upsert.length, deleted: deleteIds.length })
  } catch (e) {
    return json(res, 500, { error: e?.message || 'Failed' })
  }
}

