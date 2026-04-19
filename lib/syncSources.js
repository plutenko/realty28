import { getSupabaseAdmin } from './supabaseServer'
import { collectUnitsFromProfitbaseSource } from './profitbaseSourceSync'
import { collectUnitsFromMacroCrmSource } from './macroCrmSourceSync'
import { collectUnitsFromFskSource } from './fskSourceSync'
import { collectUnitsFromPikSource } from './pikSourceSync'
import { collectUnitsFromAmurstroySource } from './amurstroySourceSync'
import { upsertImportedUnits } from './upsertImportedUnits'
import {
  syncGoogleSheetsFromSource,
  shouldUseGoogleSheetsChessboardSync,
} from './syncGoogleSheetsFromSource'
import { setSourcePbOverride, clearSourcePbOverride } from './profitbaseSettings'

function parseCsv(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(',').map((cell) => cell.trim()))
}

function normalize(row) {
  return {
    floor: Number(row[0]),
    number: Number(row[1]),
    rooms: Number(row[2]),
    area: Number(row[3]),
    price: Number(row[4]),
    status: row[5] || 'available',
  }
}

function toPayload(row, sourceId, building) {
  const floor = Number(row.floor)
  const number = Number(row.number)
  const rooms = Number(row.rooms)
  const area = Number(row.area)
  const price = Number(row.price)
  const unitsPerFloor = Math.max(1, Number(building?.units_per_floor) || 4)
  const position =
    Number.isFinite(number) && number > 0 ? (number % unitsPerFloor) || unitsPerFloor : null
  const pricePerMeter =
    Number.isFinite(area) && area > 0 && Number.isFinite(price) ? Math.round(price / area) : null

  return {
    source_id: sourceId,
    building_id: building?.id ?? null,
    floor: Number.isFinite(floor) ? floor : null,
    number: Number.isFinite(number) ? number : null,
    position,
    rooms: Number.isFinite(rooms) ? rooms : null,
    area: Number.isFinite(area) ? area : null,
    price: Number.isFinite(price) ? price : null,
    price_per_meter: pricePerMeter,
    status: row.status || 'available',
  }
}

async function resolveBuildingForSource(supabase, source) {
  if (!source?.building_id) return null
  let { data, error } = await supabase
    .from('buildings')
    .select('id, units_per_floor')
    .eq('id', source.building_id)
    .maybeSingle()
  if (error && /units_per_floor/i.test(String(error.message || ''))) {
    const fallback = await supabase
      .from('buildings')
      .select('id')
      .eq('id', source.building_id)
      .maybeSingle()
    data = fallback.data
    error = fallback.error
  }
  if (error) throw error
  return data ?? null
}

async function syncGoogle(source) {
  const res = await fetch(source.url)
  if (!res.ok) throw new Error(`Google source fetch failed: ${res.status}`)
  const text = await res.text()
  return parseCsv(text)
}

async function syncCsv(source) {
  const res = await fetch(source.url)
  if (!res.ok) throw new Error(`CSV source fetch failed: ${res.status}`)
  const text = await res.text()
  return parseCsv(text)
}

async function syncApi(source) {
  const res = await fetch(source.url)
  if (!res.ok) throw new Error(`API source fetch failed: ${res.status}`)
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const json = await res.json()
    if (Array.isArray(json)) return json
    if (Array.isArray(json?.data)) return json.data
    if (Array.isArray(json?.rows)) return json.rows
    return []
  }
  const text = await res.text()
  return parseCsv(text)
}

async function loadRows(source) {
  const type = String(source?.type || 'csv').toLowerCase()
  if (type === 'google' || type === 'api') return syncApi(source)
  return syncCsv(source)
}

export async function syncSource(source, providedSupabase = null) {
  const supabase = providedSupabase || getSupabaseAdmin()
  if (!supabase) throw new Error('Supabase admin is not configured')

  if (!source?.building_id) {
    throw new Error(
      `Source "${source?.name || source?.id}" has no building_id. Select a building in /admin/sources.`
    )
  }

  const building = await resolveBuildingForSource(supabase, source)
  if (!building) {
    throw new Error(`Building not found for source "${source?.name || source?.id}"`)
  }

  const sourceType = String(source?.type || '').toLowerCase()
  if (sourceType === 'manual') {
    console.log(
      `[syncSources] skip source id=${source?.id} name=${JSON.stringify(source?.name ?? '')}: ` +
        `type "manual" is deprecated — open /admin/sources, save as «CSV файл» to migrate.`
    )
    return {
      sourceId: source.id,
      inserted: 0,
      skipped: true,
      skipNote:
        'Устаревший тип в БД. Откройте источник в /admin/sources и сохраните с типом «CSV файл».',
    }
  }

  if (shouldUseGoogleSheetsChessboardSync(source)) {
    const gs = await syncGoogleSheetsFromSource(supabase, source)
    if (!gs.ok) {
      throw new Error(gs.error || 'Google Sheets sync failed')
    }
    return { sourceId: source.id, inserted: gs.count }
  }

  let insertedCount = 0
  const typeLc = String(source?.type || '').toLowerCase()
  if (typeLc === 'pik') {
    const existingEntrance = Array.isArray(building?.units_per_entrance) ? building.units_per_entrance : null
    const { units, error, meta } = await collectUnitsFromPikSource(source, existingEntrance)
    if (error) throw new Error(error)
    const upd = {}
    if (meta?.unitsPerFloor && Number(meta.unitsPerFloor) > 0) {
      upd.units_per_floor = Number(meta.unitsPerFloor)
    }
    if (meta?.floorsCount && Number(meta.floorsCount) > 0) {
      upd.floors = Number(meta.floorsCount)
    }
    if (Array.isArray(meta?.unitsPerEntrance) && meta.unitsPerEntrance.length > 0) {
      upd.units_per_entrance = meta.unitsPerEntrance
    }
    if (Object.keys(upd).length > 0) {
      const { error: updErr } = await supabase.from('buildings').update(upd).eq('id', building?.id)
      if (updErr && !/units_per_entrance/i.test(String(updErr.message || ''))) throw updErr
    }
    const { count } = await upsertImportedUnits(supabase, units)
    return { sourceId: source.id, inserted: count }
  }

  if (typeLc === 'fsk') {
    const { units, error, meta } = await collectUnitsFromFskSource(source)
    if (error) throw new Error(error)
    if (meta?.unitsPerFloor && Number(meta.unitsPerFloor) > 0) {
      const upd = { units_per_floor: Number(meta.unitsPerFloor) }
      if (meta?.floorsCount && Number(meta.floorsCount) > 0) upd.floors = Number(meta.floorsCount)
      const { error: updErr } = await supabase.from('buildings').update(upd).eq('id', building?.id)
      if (updErr && !/units_per_entrance/i.test(String(updErr.message || ''))) throw updErr
    }
    const { count } = await upsertImportedUnits(supabase, units)
    return { sourceId: source.id, inserted: count }
  }

  if (typeLc === 'amurstroy') {
    const { units, error, meta } = await collectUnitsFromAmurstroySource(source)
    if (error) throw new Error(error)
    const upd = {}
    if (meta?.unitsPerFloor && Number(meta.unitsPerFloor) > 0) {
      upd.units_per_floor = Number(meta.unitsPerFloor)
    }
    if (meta?.floorsCount && Number(meta.floorsCount) > 0) {
      upd.floors = Number(meta.floorsCount)
    }
    if (Array.isArray(meta?.unitsPerEntrance) && meta.unitsPerEntrance.length > 0) {
      upd.units_per_entrance = meta.unitsPerEntrance
    }
    if (Object.keys(upd).length > 0) {
      const { error: updErr } = await supabase.from('buildings').update(upd).eq('id', building?.id)
      if (updErr && !/units_per_entrance/i.test(String(updErr.message || ''))) throw updErr
    }
    const { count } = await upsertImportedUnits(supabase, units)
    return { sourceId: source.id, inserted: count }
  }

  const isMacroCrmType = typeLc === 'macrocrm'
  if (isMacroCrmType) {
    const { units, error, meta } = await collectUnitsFromMacroCrmSource(source)
    if (error) throw new Error(error)
    if (meta?.unitsPerFloor && Number(meta.unitsPerFloor) > 0) {
      const upd = { units_per_floor: Number(meta.unitsPerFloor) }
      if (meta?.floorsCount && Number(meta.floorsCount) > 0) upd.floors = Number(meta.floorsCount)
      const { error: updErr } = await supabase.from('buildings').update(upd).eq('id', building?.id)
      if (updErr && !/units_per_entrance/i.test(String(updErr.message || ''))) throw updErr
    }
    const { count } = await upsertImportedUnits(supabase, units)
    return { sourceId: source.id, inserted: count }
  }
  const isProfitbaseType = typeLc === 'profitbase'
  if (isProfitbaseType) {
    // Always clear stale cache + set per-source Profitbase settings
    await clearSourcePbOverride()
    if (source.pb_account_id || source.pb_referer) {
      setSourcePbOverride({
        accountId: source.pb_account_id || '',
        siteWidgetReferer: source.pb_referer || '',
        pbApiKey: source.pb_api_key || '',
        pbDomain: source.pb_domain || 'profitbase.ru',
      })
    }
    let syncResult
    try {
      syncResult = await collectUnitsFromProfitbaseSource(source)
    } finally {
      await clearSourcePbOverride()
    }
    const { units, error, meta } = syncResult
    if (error) {
      throw new Error(error)
    }

    // Для Profitbase корректируем схему шахматки: реальное кол-во квартир на этаже
    // и (по возможности) кол-во этажей — берём из данных Profitbase.
    if (meta?.unitsPerFloor && Number.isFinite(Number(meta.unitsPerFloor)) && Number(meta.unitsPerFloor) > 0) {
      const upd = {
        units_per_floor: Number(meta.unitsPerFloor),
      }
      if (meta?.floorsCount && Number.isFinite(Number(meta.floorsCount)) && Number(meta.floorsCount) > 0) {
        upd.floors = Number(meta.floorsCount)
      }
      if (Array.isArray(meta?.unitsPerEntrance) && meta.unitsPerEntrance.length > 0) {
        upd.units_per_entrance = meta.unitsPerEntrance
      } else if (
        Number(meta?.unitsPerFloor) > 0 &&
        Number(meta?.entrancesCount) <= 1
      ) {
        upd.units_per_entrance = [Number(meta.unitsPerFloor)]
      }
      const { error: updErr } = await supabase.from('buildings').update(upd).eq('id', building?.id)
      // Backward compatibility: если колонок нет — не падаем, продолжаем sync units.
      if (updErr && !/units_per_entrance/i.test(String(updErr.message || ''))) {
        throw updErr
      }
    }

    const { count } = await upsertImportedUnits(supabase, units)
    insertedCount = count
  } else {
    const rawRows = await loadRows(source)
    const normalized = rawRows
      .map((row) => (Array.isArray(row) ? normalize(row) : row))
      .filter((row) => Number.isFinite(Number(row?.floor)))

    const payloads = normalized.map((row) => toPayload(row, source.id, building))

    const { error: deleteErr } = await supabase.from('units').delete().eq('source_id', source.id)
    if (deleteErr) throw deleteErr

    if (payloads.length > 0) {
      const { error: insertErr } = await supabase.from('units').insert(payloads)
      if (insertErr) throw insertErr
      insertedCount = payloads.length
    }
  }

  const { error: updateErr } = await supabase
    .from('sources')
    .update({ last_sync_at: new Date().toISOString() })
    .eq('id', source.id)
  if (updateErr) throw updateErr

  return { sourceId: source.id, inserted: insertedCount }
}

export async function syncAllSources() {
  const supabase = getSupabaseAdmin()
  if (!supabase) throw new Error('Supabase admin is not configured')

  const { data: sources, error } = await supabase.from('sources').select('*')
  if (error) throw error

  const results = []
  for (const source of sources ?? []) {
    try {
      const one = await syncSource(source, supabase)
      results.push({ ok: true, ...one, name: source.name, type: source.type })
    } catch (e) {
      results.push({
        ok: false,
        sourceId: source.id,
        name: source.name,
        type: source.type,
        error: e?.message || 'Sync failed',
      })
    }
  }
  return results
}

