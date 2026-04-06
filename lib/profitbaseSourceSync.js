/**
 * Сервер: импорт квартир из Profitbase для источника (house id в source.url).
 * Токены JWT / v4 — через profitbaseWidgetJwt + profitbaseV4 (без ручного обновления).
 */
import {
  fetchProfitbaseCrmBoardBody,
  fetchProfitbaseCrmPropertyBody,
  fetchProfitbaseCrmPropertyListBody,
} from './profitbaseCrmFetch'
import { inferFloorFromFlatNumber } from './inferFloorFromFlatNumber'

export function parseProfitbaseHouseInput(rawValue) {
  const raw = String(rawValue || '').trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return raw
  try {
    const u = new URL(raw)
    const q = u.searchParams.get('house_id')
    if (q) return q.trim()
    const parts = u.pathname.split('/').filter(Boolean)
    const hi = parts.indexOf('house')
    if (hi >= 0 && parts[hi + 1]) return parts[hi + 1]
    return raw
  } catch {
    return raw
  }
}

function extractPropertiesArrayFromCrmJson(json) {
  if (Array.isArray(json)) return json
  if (
    json?.data &&
    typeof json.data === 'object' &&
    !Array.isArray(json.data) &&
    (json.data.id != null || json.data.propertyId != null)
  ) {
    return [json.data]
  }
  const candidates = [
    json?.data,
    json?.items,
    json?.properties,
    json?.result,
    json?.content,
    json?.list,
    json?.rows,
    json?.data?.properties,
    json?.data?.items,
    json?.data?.data,
  ]
  for (const c of candidates) {
    if (Array.isArray(c)) return c
    if (c && typeof c === 'object') {
      if (Array.isArray(c.items)) return c.items
      if (Array.isArray(c.data)) return c.data
      if (Array.isArray(c.properties)) return c.properties
    }
  }
  return []
}

function getCrmRowExternalId(item) {
  const id =
    item?.id ?? item?.propertyId ?? item?.property_id ?? item?.property?.id ?? null
  return id != null ? String(id) : ''
}

/** Подъезд / секция из карточки квартиры (виджет и CRM JSON могут называть по-разному). */
function extractProfitbaseSectionName(d) {
  if (!d || typeof d !== 'object') return ''
  const candidates = [
    d.sectionName,
    d.section?.name,
    d.section?.title,
    typeof d.section === 'string' ? d.section : null,
    d.buildingSectionName,
    d.porchName,
    d.porch?.name,
    typeof d.porch === 'string' ? d.porch : null,
    d.blockName,
    d.block?.name,
    d.entranceName,
    d.entrance?.name,
    d.stairwellName,
    d.stairwell,
  ]
  for (const c of candidates) {
    if (c != null && String(c).trim() !== '') return String(c).trim()
  }
  const porchNum = Number(d.porch)
  if (Number.isFinite(porchNum) && porchNum > 0) return String(Math.floor(porchNum))
  return ''
}

function extractProfitbaseSectionFromListRow(item) {
  if (!item || typeof item !== 'object') return ''
  const fromList = item.sectionName ?? item.section?.name ?? item.porchName ?? item.blockName
  if (fromList != null && String(fromList).trim() !== '') return String(fromList).trim()
  return extractProfitbaseSectionName(item)
}

function mapProfitbasePropertyDetail(json, externalId, source) {
  let d =
    json?.data?.property ??
    json?.data ??
    json?.property ??
    json?.result ??
    json
  if (Array.isArray(d)) d = d[0]
  if (!d || typeof d !== 'object') return null

  const number =
    d.number ?? d.flatNumber ?? d.apartmentNumber ?? d.apartment_no ?? null
  const floor =
    d.floor ??
    d.floorNumber ??
    d.storey ??
    d.storeyNumber ??
    d.level ??
    d.floor_number ??
    d.floorNo ??
    null
  const rooms =
    d.rooms_amount ??
    d.roomsAmount ??
    d.roomCount ??
    d.rooms ??
    d.roomsCount ??
    null
  const area =
    d.area?.area_total ??
    d.areaTotal ??
    d.area_total ??
    (typeof d.area === 'number' ? d.area : null) ??
    d.square ??
    null
  const priceRaw = d.price?.value ?? d.price?.amount ?? d.cost ?? d.price ?? null
  const price = priceRaw != null ? Number(priceRaw) : 0

  const st = String(d.status ?? d.availability ?? '').toUpperCase()
  let status = 'available'
  if (st === 'SOLD' || st === 'ПРОДАНА' || st === 'РЕАЛИЗОВАНО') status = 'sold'
  else if (st === 'RESERVED' || st === 'BOOKED' || st === 'БРОНЬ')
    status = 'reserved'

  return {
    source_id: source.id,
    building_id: source.building_id,
    external_id: String(externalId),
    number,
    floor,
    // Для шахматки используем позицию на этаже (если рассчитывается выше).
    // Значение будет подставлено в collectUnitsFromProfitbaseSource.
    position: null,
    // В БД не пишется — вспомогательное поле секции из Profitbase.
    profitbase_section: extractProfitbaseSectionName(d),
    rooms,
    area: area != null ? Number(area) : null,
    price,
    status,
  }
}

function asFiniteNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function parseBoardCells(text) {
  const raw = String(text || '').trim()
  if (!raw) return []
  let j
  try {
    j = JSON.parse(raw)
  } catch {
    return []
  }
  const board =
    (j && typeof j === 'object' && Array.isArray(j.floors) && j) ||
    (Array.isArray(j?.data) ? j.data[0] : null)
  if (!board || !Array.isArray(board.floors)) return []

  const cells = []
  for (const floorRow of board.floors) {
    const floor = asFiniteNumber(floorRow?.number)
    if (floor == null) continue
    const sections = Array.isArray(floorRow?.sections) ? floorRow.sections : []
    for (const s of sections) {
      const sectionName = String(s?.name ?? s?.number ?? '').trim()
      const secCells = Array.isArray(s?.cells) ? s.cells : []
      for (let i = 0; i < secCells.length; i += 1) {
        const c = secCells[i] ?? {}
        const pid = c?.propertyId ?? c?.property_id ?? null
        cells.push({
          floor,
          position: i + 1, // local position in section, preserving empty cells
          sectionName,
          propertyId: pid != null && /^\d+$/.test(String(pid)) ? String(pid) : null,
        })
      }
    }
  }
  return cells
}

/**
 * @returns {Promise<{ units: object[], error?: string }>}
 */
export async function collectUnitsFromProfitbaseSource(source) {
  const houseId = parseProfitbaseHouseInput(source?.url)
  if (!houseId) {
    return { units: [], error: 'Укажите в поле URL источника house_id или ссылку на дом Profitbase.' }
  }

  // 1) GRID is source of truth for structure (Profitbase board endpoint).
  const boardRes = await fetchProfitbaseCrmBoardBody(houseId)
  let cells = boardRes.ok ? parseBoardCells(boardRes.text || '') : []
  if (!cells.length) {
    // Debug: show first 500 chars of response for troubleshooting
    const snippet = boardRes.ok
      ? `board получен (${(boardRes.text || '').length} bytes), но 0 cells. Начало: ${(boardRes.text || '').slice(0, 500)}`
      : (boardRes?.error || '')
    return {
      units: [],
      error: `Не удалось получить структуру board/smallGrid для house ${houseId}. ${snippet}`.trim(),
    }
  }

  // 2) Build entrances and widths from grid cells (including empty cells).
  const sectionSet = new Set(cells.map((c) => c.sectionName || ''))
  const sectionOrder = [...sectionSet].sort((a, b) => {
    const an = asFiniteNumber(a)
    const bn = asFiniteNumber(b)
    if (an == null || bn == null) return String(a).localeCompare(String(b), 'ru')
    return an - bn
  })
  const entranceBySection = new Map(sectionOrder.map((s, i) => [s, i + 1]))

  const maxPosByEntrance = new Map()
  let floorsCount = 0
  for (const c of cells) {
    floorsCount = Math.max(floorsCount, Number(c.floor) || 0)
    const e = entranceBySection.get(c.sectionName || '') || 1
    const p = Number(c.position) || 0
    maxPosByEntrance.set(e, Math.max(maxPosByEntrance.get(e) || 0, p))
  }
  const unitsPerEntrance = []
  for (let e = 1; e <= sectionOrder.length; e += 1) {
    unitsPerEntrance.push(Math.max(1, maxPosByEntrance.get(e) || 0))
  }
  const entranceOffsets = new Map()
  let off = 0
  for (let e = 1; e <= unitsPerEntrance.length; e += 1) {
    entranceOffsets.set(e, off)
    off += unitsPerEntrance[e - 1]
  }
  const unitsPerFloor = off

  // 3) Details from CRM/property; never used to build structure.
  const detailsById = new Map()
  const list = await fetchProfitbaseCrmPropertyListBody(houseId)
  if (list.ok && list.text?.trim()) {
    try {
      const crmJson = JSON.parse(list.text)
      const rows = extractPropertiesArrayFromCrmJson(crmJson)
      for (const item of rows) {
        const ext = getCrmRowExternalId(item)
        if (!ext) continue
        const u = mapProfitbasePropertyDetail({ data: item }, ext, source)
        if (u) detailsById.set(ext, u)
      }
    } catch {
      // ignore
    }
  }

  const propertyIds = [...new Set(cells.map((c) => c.propertyId).filter(Boolean))]
  const missing = propertyIds.filter((id) => !detailsById.has(id))
  const BATCH = 5
  for (let i = 0; i < missing.length; i += BATCH) {
    const slice = missing.slice(i, i + BATCH)
    const batch = await Promise.all(
      slice.map(async (propertyId) => {
        const pr = await fetchProfitbaseCrmPropertyBody(propertyId)
        if (!pr.ok || !pr.text) return null
        try {
          const pj = JSON.parse(pr.text)
          return { id: propertyId, unit: mapProfitbasePropertyDetail(pj, propertyId, source) }
        } catch {
          return null
        }
      })
    )
    for (const x of batch) {
      if (x?.id && x?.unit) detailsById.set(x.id, x.unit)
    }
  }

  // 4) Create units only for occupied cells. Позиции/подъезд — из сетки; этаж —
    // из номера квартиры, если он однозначно кодирует этаж (иначе оставляем этаж ячейки).
  const units = []
  for (const c of cells) {
    if (!c.propertyId) continue // empty cells are preserved via grid meta widths; do not create fake units
    const detail = detailsById.get(c.propertyId)
    if (!detail) continue
    const entrance = entranceBySection.get(c.sectionName || '') || 1
    const localPos = Number(c.position)
    const floorGrid = Number(c.floor)
    const inferred = inferFloorFromFlatNumber(detail.number)
    const floor = inferred != null ? inferred : floorGrid
    const offset = entranceOffsets.get(entrance) || 0
    const position = offset + localPos
    const unit = {
      ...detail,
      floor,
      entrance,
      position,
    }
    units.push(unit)
    console.log('PB UNIT:', {
      id: c.propertyId,
      floorGrid,
      floor,
      number: detail.number,
      position,
      entrance,
    })
  }

  if (!units.length) {
    const totalCells = cells.length
    const withPropId = cells.filter((c) => c.propertyId).length
    const detailCount = detailsById.size
    const sampleIds = cells.filter((c) => c.propertyId).slice(0, 5).map((c) => c.propertyId)
    return {
      units: [],
      error: `smallGrid получен (${totalCells} ячеек, ${withPropId} с propertyId, ${detailCount} деталей загружено). Примеры ID: ${sampleIds.join(', ') || 'нет'}. Board: ${(boardRes.text || '').slice(0, 300)}`,
    }
  }

  units.sort((a, b) => {
    if (Number(a.entrance) !== Number(b.entrance)) return Number(a.entrance) - Number(b.entrance)
    if (Number(a.floor) !== Number(b.floor)) return Number(b.floor) - Number(a.floor)
    return Number(a.position) - Number(b.position)
  })

  let floorsCountFromUnits = 0
  for (const u of units) {
    const f = Number(u.floor)
    if (!Number.isFinite(f)) continue
    const sf = Math.max(1, Number(u.span_floors) || 1)
    floorsCountFromUnits = Math.max(floorsCountFromUnits, f + sf - 1)
  }

  const meta = {
    floorsCount: Math.max(floorsCount, floorsCountFromUnits),
    unitsPerFloor,
    entrancesCount: unitsPerEntrance.length,
    unitsPerEntrance,
  }

  return { units, meta }
}
