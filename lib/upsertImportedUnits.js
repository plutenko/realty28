import { upsertUnitsStrippingUnknownColumns } from './supabaseUpsertColumnFallback'

/**
 * Общая логика POST /api/import-units — upsert квартир + sold по last_seen_at.
 *
 * @param {object} [options]
 * @param {'external_id'|'building_id,number'} [options.conflictKey]
 *   Стратегия разрешения конфликтов:
 *   - 'external_id' (по умолч.) — для Profitbase: stable ID из внешней системы.
 *   - 'building_id,number' — для Google Sheets парсеров: номер квартиры в доме
 *     (external_id у разных парсеров формируется по-разному и может меняться).
 * @returns {{ count: number }}
 */
export async function upsertImportedUnits(supabase, units, { conflictKey = 'external_id' } = {}) {
  if (!supabase) throw new Error('Supabase admin is not configured')
  if (!Array.isArray(units)) throw new Error('Expected units array')

  const syncNow = new Date().toISOString()

  const normalized = units
    .map((u) => {
      const hasExt = u.external_id != null && String(u.external_id).length > 0
      const floorN = u.floor != null && u.floor !== '' ? Number(u.floor) : NaN
      const floor = Number.isFinite(floorN)
        ? floorN
        : hasExt
          ? 1
          : 0
      return {
        source_id: u.source_id ?? null,
        building_id: u.building_id ?? null,
        number: u.number != null ? Number(u.number) : null,
        floor,
        entrance:
          u.entrance != null && u.entrance !== '' ? Number(u.entrance) : null,
        rooms: u.rooms != null ? Number(u.rooms) : null,
        area: u.area != null ? Number(u.area) : null,
        price: u.price != null ? Number(u.price) : 0,
        price_per_meter:
          u.price_per_meter != null ? Number(u.price_per_meter) : 0,
        position:
          u.position != null && u.position !== '' ? Number(u.position) : null,
        span_columns:
          u.span_columns != null && u.span_columns !== ''
            ? Math.max(1, Number(u.span_columns) || 1)
            : 1,
        span_floors:
          u.span_floors != null && u.span_floors !== ''
            ? Math.max(1, Number(u.span_floors) || 1)
            : 1,
        is_combined: Boolean(u.is_combined),
        combined_unit_ids: Array.isArray(u.combined_unit_ids)
          ? u.combined_unit_ids
          : [],
        status: u.status ?? 'available',
        external_id: u.external_id != null ? String(u.external_id) : null,
        layout_title: u.layout_title != null ? String(u.layout_title) : null,
        is_commercial: Boolean(u.is_commercial),
        last_seen_at: syncNow,
      }
    })
    .filter(
      (u) =>
        u.source_id &&
        u.building_id &&
        // Для upsert:
        // - если есть external_id — синхронизируем по нему (он уникальный)
        // - если external_id нет — тогда обязателен номер квартиры (для conflict по building_id,number)
        (String(u.external_id || '').length > 0 || Number.isFinite(Number(u.number)))
    )

  let count = 0
  if (normalized.length > 0) {
    // Чтобы не ловить конфликт уникальности external_id, синхронизируем
    // все строки с external_id именно по external_id.
    const withExternal = normalized.filter((u) => u.external_id)
    const withoutExternal = normalized.filter((u) => !u.external_id)

    if (conflictKey === 'building_id,number') {
      // Google Sheets парсеры: external_id нестабилен (зависит от формата таблицы).
      // Уникальный ключ — (building_id, number). Дедуплицируем батч перед вставкой.
      const hasValidNumber = (u) => Number.isFinite(Number(u.number)) && Number(u.number) > 0

      const withNumber    = normalized.filter(hasValidNumber)
      const withoutNumber = normalized.filter((u) => !hasValidNumber(u))

      if (withNumber.length > 0) {
        const deduped = Array.from(
          withNumber.reduce((map, u) => {
            map.set(`${u.building_id}::${u.number}`, u)
            return map
          }, new Map()).values()
        )
        await upsertUnitsStrippingUnknownColumns(supabase, deduped, {
          onConflict: 'building_id,number',
        })
        count += deduped.length
      }

      // Юниты без номера (коммерческие) — по external_id
      if (withoutNumber.length > 0) {
        const withExt = withoutNumber.filter((u) => u.external_id)
        if (withExt.length > 0) {
          const dedupedExt = Array.from(
            withExt.reduce((map, u) => {
              map.set(String(u.external_id), u)
              return map
            }, new Map()).values()
          )
          await upsertUnitsStrippingUnknownColumns(supabase, dedupedExt, {
            onConflict: 'external_id',
          })
          count += dedupedExt.length
        }
      }
    } else {
      // Profitbase и другие: stable external_id из внешней системы.
      const withExternal  = normalized.filter((u) => u.external_id)
      const withoutExternal = normalized.filter((u) => !u.external_id)

      if (withExternal.length > 0) {
        const deduped = Array.from(
          withExternal.reduce((map, u) => {
            map.set(String(u.external_id), u)
            return map
          }, new Map()).values()
        )
        await upsertUnitsStrippingUnknownColumns(supabase, deduped, {
          onConflict: 'external_id',
        })
        count += deduped.length
      }

      if (withoutExternal.length > 0) {
        const withNumber = withoutExternal.filter((u) => Number.isFinite(Number(u.number)))
        if (withNumber.length > 0) {
          const deduped = Array.from(
            withNumber.reduce((map, u) => {
              map.set(`${u.building_id}::${u.number}`, u)
              return map
            }, new Map()).values()
          )
          await upsertUnitsStrippingUnknownColumns(supabase, deduped, {
            onConflict: 'building_id,number',
          })
          count += deduped.length
        }
      }
    }

    const srcId = normalized[0]?.source_id
    const bId = normalized[0]?.building_id
    if (srcId && bId) {
      const { error: staleErr } = await supabase
        .from('units')
        .update({ status: 'sold' })
        .eq('source_id', srcId)
        .eq('building_id', bId)
        .lt('last_seen_at', syncNow)
      if (staleErr) throw staleErr
    }

    if (srcId) {
      const { error: srcErr } = await supabase
        .from('sources')
        .update({ last_sync_at: syncNow })
        .eq('id', srcId)
      if (srcErr) throw srcErr
    }
  }

  return { count }
}
