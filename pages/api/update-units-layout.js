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

    // Авто-привязка новых ручных квартир к MacroCRM-источнику дома:
    // если у здания ровно один macrocrm source — подставим source_id и external_id=manual-<number>.
    // Это позволяет синку отслеживать статус (с нашим исключением `manual-` для sold-mark).
    const buildingIds = [
      ...new Set(
        upsert
          .filter((u) => !String(u?.id || '').trim() && u?.building_id)
          .map((u) => u.building_id)
      ),
    ]
    const sourceByBuilding = new Map()
    if (buildingIds.length) {
      const { data: src } = await supabase
        .from('sources')
        .select('id, building_id, type')
        .in('building_id', buildingIds)
        .eq('type', 'macrocrm')
      for (const s of src ?? []) {
        if (!sourceByBuilding.has(s.building_id)) {
          sourceByBuilding.set(s.building_id, s.id)
        }
      }
    }

    if (upsert.length) {
      const now = new Date().toISOString()
      const rows = upsert.map((u) => {
        const isNew = !String(u?.id || '').trim()
        let sourceId = u.source_id ?? null
        let externalId = u.external_id ?? null
        if (isNew && !sourceId && u.building_id) {
          const autoSrc = sourceByBuilding.get(u.building_id)
          if (autoSrc && u.number != null) {
            sourceId = autoSrc
            externalId = `manual-${u.number}`
          }
        }
        const row = {
          id: ensureUnitId(u.id),
          building_id: u.building_id ?? null,
          source_id: sourceId,
          external_id: externalId,
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
        }
        // Only include image fields if explicitly provided — don't overwrite with null
        if ('layout_image_url' in u) row.layout_image_url = u.layout_image_url ?? null
        if ('finish_image_url' in u) row.finish_image_url = u.finish_image_url ?? null
        // Для новых ручных квартир с source_id — проставляем last_seen_at в будущее,
        // чтобы ближайший синк не пометил их как sold.
        if (isNew && sourceId) row.last_seen_at = now
        return row
      })

      try {
        await upsertUnitsStrippingUnknownColumns(supabase, rows, {
          onConflict: 'id',
        })
      } catch (e) {
        // If duplicate building_id+number, retry with that conflict key
        if (/units_building_id_number_key|duplicate key/.test(String(e?.message || ''))) {
          await upsertUnitsStrippingUnknownColumns(supabase, rows, {
            onConflict: 'building_id,number',
          })
        } else {
          throw e
        }
      }
    }

    return json(res, 200, { ok: true, upserted: upsert.length, deleted: deleteIds.length })
  } catch (e) {
    return json(res, 500, { error: e?.message || 'Failed' })
  }
}

