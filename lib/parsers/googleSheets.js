import * as XLSX from 'xlsx'

const { encode_cell: encodeCell, decode_range: decodeRange, decode_cell: decodeCell } =
  XLSX.utils

/** Колонка AA — легенда цветов статуса (1-based в Excel = индекс 26). */
const LEGEND_COL_AA = decodeCell('AA1').c

/**
 * Легенда в AA: продана (строки Excel 2–7), бронь (10–12), свободна (15–17).
 * Индексы строк 0-based (r для AA2 = 1).
 */
const LEGEND_ROWS_SOLD = [1, 2, 3, 4, 5, 6]
const LEGEND_ROWS_BOOKED = [9, 10, 11]
const LEGEND_ROWS_AVAILABLE = [14, 15, 16]

function isBlank(v) {
  return v === undefined || v === null || v === ''
}

function numOrNull(v) {
  if (isBlank(v)) return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  let s = String(v).trim().replace(/\u00a0/g, '').replace(/\s/g, '')
  // Русские дроби: 12,1 → 12.1 (если нет точки как разделителя тысяч)
  if (s.includes(',') && !s.includes('.')) {
    s = s.replace(',', '.')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function normStr(v) {
  if (isBlank(v)) return ''
  return String(v).replace(/\s+/g, ' ').trim()
}

/**
 * Map layout_type cell to rooms count.
 * @param {unknown} layoutType
 * @returns {number|null}
 */
function roomsFromLayout(layoutType) {
  const s = normStr(layoutType).toLowerCase()
  if (!s) return null
  if (s.includes('коммерц')) return null
  if (s.includes('студ')) return 0
  // Порядок: сначала «3 кк», затем 2 и 1 — чтобы не перепутать с «12 кк».
  if (/(^|[^\d])3\s*к\s*к/.test(s) || /3\s*кк/.test(s)) return 3
  if (/(^|[^\d])2\s*к\s*к/.test(s) || /2\s*кк/.test(s)) return 2
  if (/(^|[^\d])1\s*к\s*к/.test(s) || /1\s*кк/.test(s)) return 1
  return null
}

/**
 * Двухуровневые квартиры — занимают два этажа; floor в данных — нижний.
 * @param {unknown} layoutType
 * @returns {number}
 */
function spanFloorsFromLayout(layoutType) {
  const s = normStr(layoutType).toLowerCase()
  if (s.includes('2 уровень') || s.includes('двухуровн')) return 2
  return 1
}

/**
 * Sodruzhestvo: объединённая ячейка на два этажных блока (по 3 строки на этаж).
 * SheetJS: sheet['!merges'] — { s: {r,c}, e: {r,c} }, индексы 0-based.
 * Следующий этаж начинается с row+3; объединение должно доходить до этой строки или ниже.
 * Проверяем c0/c1/c2 и строки row..row+2 — номер может быть в соседней колонке или
 * визуально в середине блока, а не строго в (row, c0).
 *
 * @param {Record<string, unknown>} sheet
 * @param {number} row - строка блока «A» текущего этажа (i)
 * @param {number} c0
 * @param {number} c1
 * @param {number} c2
 * @returns {boolean}
 */
function apartmentBlockMergedAcrossNextFloorBlock(sheet, row, c0, c1, c2) {
  const merges = sheet['!merges']
  if (!Array.isArray(merges)) return false
  const cols = [c0, c1, c2]
  for (const m of merges) {
    if (!m || typeof m !== 'object') continue
    const s = m.s
    const e = m.e
    if (!s || !e) continue
    if (e.r < row + 3) continue
    for (let rr = row; rr <= row + 2; rr += 1) {
      for (const col of cols) {
        if (col < s.c || col > e.c) continue
        if (rr < s.r || rr > e.r) continue
        return true
      }
    }
  }
  return false
}

/**
 * Целое для units.number из подписи «Помещение 1.3»: дробь × 10 (1.3 → 13).
 * external_id по-прежнему полный текст в parseGoogleSheetsChessboard.
 * @param {unknown} raw
 * @returns {number|null}
 */
function numberFromCommercialLabel(raw) {
  const s = normStr(raw)
  if (!s) return null
  let parsed = null
  const tail = s.match(/(\d+(?:[.,]\d+)?)\s*$/)
  if (tail) parsed = numOrNull(tail[1])
  if (parsed == null) {
    const any = s.match(/(\d+(?:[.,]\d+)?)/)
    parsed = any ? numOrNull(any[1]) : null
  }
  if (parsed == null || !Number.isFinite(parsed)) return null
  return Math.round(parsed * 10)
}

/**
 * Section status from last non-null cell in row B (fallback если в xlsx нет заливок).
 * @param {unknown} raw
 * @returns {'sold'|'booked'|'available'}
 */
function statusFromSection(raw) {
  const s = normStr(raw).toLowerCase()
  if (!s) return 'available'
  if (s.includes('продан')) return 'sold'
  if (s.includes('брон')) return 'booked'
  return 'available'
}

/** @param {string} hex */
function hexToRgb(hex) {
  const h = String(hex || '')
    .replace(/^#/, '')
    .replace(/^FF(?=[0-9A-Fa-f]{6})/, '')
  const six = h.length <= 6 ? h : h.slice(-6)
  if (!/^[0-9A-Fa-f]{6}$/.test(six)) return null
  return {
    r: parseInt(six.slice(0, 2), 16),
    g: parseInt(six.slice(2, 4), 16),
    b: parseInt(six.slice(4, 6), 16),
  }
}

/** @param {{ r: number, g: number, b: number }} rgb */
function rgbIsNearWhite(rgb) {
  if (!rgb) return true
  return rgb.r >= 248 && rgb.g >= 248 && rgb.b >= 248
}

/**
 * Ячейка «белая» / без заливки → свободна. Любая явная заливка (серый125, цвет и т.д.) → не свободна.
 * @param {Record<string, unknown>|null|undefined} fill
 */
function fillIsPlainWhite(fill) {
  if (fill == null) return true
  const pt = fill.patternType
  if (pt === 'none' || pt == null) return true
  if (pt === 'gray125' || pt === 'darkGray' || pt === 'lightGray') return false

  const fg = fill.fgColor
  const bg = fill.bgColor
  if (fg?.indexed != null || bg?.indexed != null) return false

  const fr = hexToRgb(fg?.rgb)
  const br = hexToRgb(bg?.rgb)
  if (fr && !rgbIsNearWhite(fr)) return false
  if (br && !rgbIsNearWhite(br)) return false
  if (pt === 'solid' && !fr && !br) return true
  if (fr || br) return rgbIsNearWhite(fr) && rgbIsNearWhite(br)
  return true
}

/** @param {Record<string, unknown>|null|undefined} fill */
function fillToRgb(fill) {
  if (fill == null) return null
  const pt = fill.patternType
  if (pt === 'none' || pt == null) return null

  const fr = hexToRgb(fill.fgColor?.rgb)
  const br = hexToRgb(fill.bgColor?.rgb)
  if (fr && br) {
    if (rgbIsNearWhite(fr) && !rgbIsNearWhite(br)) return br
    if (rgbIsNearWhite(br) && !rgbIsNearWhite(fr)) return fr
    return fr
  }
  return fr || br || null
}

/** @param {Array<{ r: number, g: number, b: number }>} samples */
function averageRgb(samples) {
  if (!samples.length) return null
  let r = 0
  let g = 0
  let b = 0
  for (const o of samples) {
    r += o.r
    g += o.g
    b += o.b
  }
  const n = samples.length
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) }
}

/**
 * @param {{ r: number, g: number, b: number }} a
 * @param {{ r: number, g: number, b: number }} b
 */
function colorDistanceSq(a, b) {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return dr * dr + dg * dg + db * db
}

/**
 * @typedef {{ sold: { r: number, g: number, b: number }|null, booked: { r: number, g: number, b: number }|null, available: { r: number, g: number, b: number }|null }} StatusLegend
 */

/** @param {Record<string, unknown>} sheet */
function parseStatusLegendFromColumnAA(sheet) {
  const col = LEGEND_COL_AA
  /** @type {StatusLegend} */
  const legend = { sold: null, booked: null, available: null }

  const avgForRows = (rows) => {
    const samples = []
    for (const r of rows) {
      const rgb = fillToRgb(sheetCellFill(sheet, r, col))
      if (rgb) samples.push(rgb)
    }
    return averageRgb(samples)
  }

  legend.sold = avgForRows(LEGEND_ROWS_SOLD)
  legend.booked = avgForRows(LEGEND_ROWS_BOOKED)
  legend.available = avgForRows(LEGEND_ROWS_AVAILABLE)
  return legend
}

/** @param {StatusLegend} legend */
function legendIsUsable(legend) {
  const n = [legend.sold, legend.booked, legend.available].filter(Boolean).length
  return n >= 2
}

/** @param {Record<string, unknown>} sheet */
function sheetCellFill(sheet, row, col) {
  const ref = encodeCell({ r: row, c: col })
  const cell = sheet[ref]
  return cell?.s ?? null
}

/**
 * Средний RGB по блоку квартиры (номер, площадь, планировка, ₽/м², цена).
 * @param {Record<string, unknown>} sheet
 */
function apartmentBlockAverageRgb(sheet, rowA, c0, c1, c2) {
  const positions = [
    [rowA, c0],
    [rowA, c1],
    [rowA, c2],
    [rowA + 1, c2],
    [rowA + 2, c2],
  ]
  const samples = []
  for (const [r, c] of positions) {
    const rgb = fillToRgb(sheetCellFill(sheet, r, c))
    if (rgb) samples.push(rgb)
  }
  return averageRgb(samples)
}

/**
 * Статус по легенде AA: ближайший эталонный цвет.
 * @param {Record<string, unknown>} sheet
 * @param {StatusLegend} legend
 * @param {'sold'|'booked'|'available'} fallback
 */
function statusFromLegendMatch(sheet, rowA, c0, c1, c2, legend, fallback) {
  const subject =
    apartmentBlockAverageRgb(sheet, rowA, c0, c1, c2) ||
    fillToRgb(sheetCellFill(sheet, rowA, c0))
  if (!subject) return fallback

  /** @type {Array<{ st: 'sold'|'booked'|'available', rgb: { r: number, g: number, b: number } }>} */
  const refs = []
  if (legend.sold) refs.push({ st: 'sold', rgb: legend.sold })
  if (legend.booked) refs.push({ st: 'booked', rgb: legend.booked })
  if (legend.available) refs.push({ st: 'available', rgb: legend.available })
  if (!refs.length) return fallback

  let best = refs[0].st
  let bestD = colorDistanceSq(subject, refs[0].rgb)
  for (let i = 1; i < refs.length; i++) {
    const d = colorDistanceSq(subject, refs[i].rgb)
    if (d < bestD) {
      bestD = d
      best = refs[i].st
    }
  }
  return best
}

/**
 * Квартира: без легенды — белые ячейки = свободна, иначе продана.
 */
function statusFromApartmentCellFills(sheet, rowA, c0, c1, c2) {
  const positions = [
    [rowA, c0],
    [rowA, c1],
    [rowA, c2],
    [rowA + 1, c2],
    [rowA + 2, c2],
  ]
  for (const [r, c] of positions) {
    if (!fillIsPlainWhite(sheetCellFill(sheet, r, c))) return 'sold'
  }
  return 'available'
}

/**
 * Есть ли на листе осмысленные заливки (не только «пустой» стиль).
 * @param {Record<string, unknown>} sheet
 */
function sheetHasDistinctFills(sheet) {
  const ref = sheet['!ref']
  if (!ref || typeof ref !== 'string') return false
  let d
  try {
    d = decodeRange(ref)
  } catch {
    return false
  }
  const maxR = Math.min(d.e.r, d.s.r + 80)
  const maxC = Math.min(d.e.c, d.s.c + 40)
  for (let R = d.s.r; R <= maxR; R++) {
    for (let C = d.s.c; C <= maxC; C++) {
      const fill = sheetCellFill(sheet, R, C)
      if (fill == null) continue
      if (fill.patternType && fill.patternType !== 'none') {
        if (fill.patternType === 'gray125') return true
        const fr = hexToRgb(fill.fgColor?.rgb)
        const br = hexToRgb(fill.bgColor?.rgb)
        if ((fr && !rgbIsNearWhite(fr)) || (br && !rgbIsNearWhite(br))) return true
      }
    }
  }
  return false
}

function rowCell(row, idx) {
  if (!Array.isArray(row) || idx < 0) return null
  if (idx >= row.length) return null
  const v = row[idx]
  return isBlank(v) ? null : v
}

/**
 * Этаж 1: «Помещение X.Y» может быть в любой колонке (объединённые ячейки ломают шаг 3k+1).
 * Ищем все колонки с «помещение» в строке A и подбираем площадь / «Коммерция» / ₽ справа.
 */
function scanCommercialPremisesRow(
  sheet,
  rowIndex,
  rowA,
  rowB,
  rowC,
  maxLen,
  idPrefix,
  useLegend,
  useFillForStatus,
  legend,
  blockStatus,
  floorN
) {
  /** @type {Array<Record<string, unknown>>} */
  const found = []
  for (let c = 1; c < maxLen; c += 1) {
    const unitRaw = rowCell(rowA, c)
    const labelLower = normStr(unitRaw).toLowerCase()
    if (!labelLower.includes('помещение')) continue

    let areaCol = null
    let areaVal = null
    let layoutCol = null

    for (let j = c + 1; j < maxLen; j += 1) {
      const cell = rowCell(rowA, j)
      const t = normStr(cell).toLowerCase()
      if (t.includes('помещение')) break
      if (t.includes('коммерц')) {
        layoutCol = j
        break
      }
      const n = numOrNull(cell)
      if (n != null && areaCol === null) {
        areaCol = j
        areaVal = n
      }
    }

    if (layoutCol == null) {
      for (let j = (areaCol ?? c) + 1; j < maxLen; j += 1) {
        const t = normStr(rowCell(rowA, j)).toLowerCase()
        if (t.includes('помещение')) break
        if (t.includes('коммерц')) {
          layoutCol = j
          break
        }
      }
    }

    let areaComm = areaVal
    if (areaComm == null && layoutCol != null) {
      for (let j = c + 1; j < layoutCol; j += 1) {
        const n = numOrNull(rowCell(rowA, j))
        if (n != null) {
          areaComm = n
          areaCol = areaCol ?? j
          break
        }
      }
    }
    const c1 = areaCol ?? c + 1
    const c2 = layoutCol ?? (areaCol != null ? areaCol + 1 : c + 2)
    if (areaComm == null) areaComm = numOrNull(rowCell(rowA, c1))

    const ppmComm = numOrNull(rowCell(rowB, c2))
    const priceComm = numOrNull(rowCell(rowC, c2))

    if (areaComm === null && priceComm === null) continue

    let statusComm
    if (useLegend) {
      statusComm = statusFromLegendMatch(sheet, rowIndex, c, c1, c2, legend, blockStatus)
    } else if (useFillForStatus) {
      statusComm = statusFromApartmentCellFills(sheet, rowIndex, c, c1, c2)
    } else {
      statusComm = blockStatus
    }

    const idStr = normStr(unitRaw)
    found.push({
      external_id: `${idPrefix}-${idStr}`,
      number: numberFromCommercialLabel(unitRaw) ?? 0,
      floor: Math.trunc(floorN),
      rooms: null,
      area: areaComm,
      price: priceComm,
      price_per_meter: ppmComm,
      status: statusComm,
      layout_title: 'Коммерция',
      span_floors: 1,
      is_commercial: true,
      commercial_label: idStr,
    })
  }
  return found
}

function dedupeUnitsByExternalId(rows) {
  const seen = new Map()
  for (const r of rows) {
    const k = String(r?.external_id ?? '').trim()
    if (!k) continue
    seen.set(k, r)
  }
  return [...seen.values()]
}

/**
 * Sodruzhestvo-style chessboard: блок из 3 строк на этаж (A — этаж и квартиры, B — ₽/м², C — цена).
 * Строки «Этаж» / «Ось» сверху не кратны 3 от начала листа — ищем строки, где в A число этажа 1–60.
 * Легенда цветов статуса в колонке AA: строки 2–7 — продана, 10–12 — бронь, 15–17 — свободна (средний RGB по ячейкам диапазона).
 *
 * @param {Buffer} buffer - xlsx file buffer
 * @param {string} sheetName - worksheet name
 * @returns {Array<{
 *   external_id: string,
 *   number: number,
 *   floor: number,
 *   rooms: number|null,
 *   area: number|null,
 *   price: number|null,
 *   price_per_meter: number|null,
 *   status: string,
 *   layout_title: string|null,
 *   span_floors: number
 * }>}
 */
export function parseGoogleSheetsChessboard(buffer, sheetName) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellStyles: true })
  const name = String(sheetName || '').trim()
  const sheet =
    (name && wb.Sheets[name]) ||
    wb.Sheets[wb.SheetNames[0] || ''] ||
    null
  if (!sheet) {
    return []
  }

  /** @type {any[][]} */
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  })

  const legend = parseStatusLegendFromColumnAA(sheet)
  const useLegend = legendIsUsable(legend)
  const useFillForStatus = !useLegend && sheetHasDistinctFills(sheet)

  const idPrefix = name || 'sheet'
  const out = []

  let i = 0
  while (i + 2 < rows.length) {
    const rowA = rows[i] || []
    const floorN = numOrNull(rowCell(rowA, 0))
    if (!Number.isFinite(floorN) || floorN < 1 || floorN > 60) {
      i += 1
      continue
    }

    const rowB = rows[i + 1] || []
    const rowC = rows[i + 2] || []

    let sectionRaw = null
    for (let c = rowB.length - 1; c >= 0; c--) {
      const v = rowCell(rowB, c)
      if (v !== null && v !== undefined) {
        sectionRaw = v
        break
      }
    }
    const blockStatus = statusFromSection(sectionRaw)

    const maxLen = Math.max(rowA.length, rowB.length, rowC.length, 1)
    let k = 0
    while (1 + 3 * k + 2 < maxLen) {
      const c0 = 1 + 3 * k
      const c1 = 2 + 3 * k
      const c2 = 3 + 3 * k

      const unitRaw = rowCell(rowA, c0)
      const unitNum = numOrNull(unitRaw)
      const cellA1 = rowCell(rowA, c1)
      const cellA2 = rowCell(rowA, c2)
      const c0Lower = normStr(unitRaw).toLowerCase()
      const c1Lower = normStr(cellA1).toLowerCase()
      const c2Lower = normStr(cellA2).toLowerCase()

      const isCommercial =
        (!Number.isFinite(unitNum) || unitNum < 1) &&
        normStr(unitRaw) &&
        (c0Lower.includes('помещение') ||
          c1Lower.includes('помещение') ||
          c2Lower.includes('коммерц'))

      if (isCommercial) {
        const idStr = normStr(unitRaw)
        const areaComm = numOrNull(cellA1)
        const ppmComm = numOrNull(rowCell(rowB, c2))
        const priceComm = numOrNull(rowCell(rowC, c2))

        if (areaComm === null && priceComm === null) {
          k += 1
          continue
        }

        let statusComm
        if (useLegend) {
          statusComm = statusFromLegendMatch(sheet, i, c0, c1, c2, legend, blockStatus)
        } else if (useFillForStatus) {
          statusComm = statusFromApartmentCellFills(sheet, i, c0, c1, c2)
        } else {
          statusComm = blockStatus
        }

        out.push({
          external_id: `${idPrefix}-${idStr}`,
          number: numberFromCommercialLabel(unitRaw) ?? 0,
          floor: Math.trunc(floorN),
          rooms: null,
          area: areaComm,
          price: priceComm,
          price_per_meter: ppmComm,
          status: statusComm,
          layout_title: 'Коммерция',
          span_floors: 1,
          is_commercial: true,
          commercial_label: idStr,
        })

        k += 1
        continue
      }

      if (!Number.isFinite(unitNum) || unitNum < 1) {
        k += 1
        continue
      }

      const area = numOrNull(rowCell(rowA, c1))
      const layoutTitle = rowCell(rowA, c2)
      const layoutStr = layoutTitle != null ? String(layoutTitle).trim() : null

      const ppm = numOrNull(rowCell(rowB, c2))
      const priceRub = numOrNull(rowCell(rowC, c2))

      if (area === null && priceRub === null && !layoutStr) {
        k += 1
        continue
      }

      let status
      if (useLegend) {
        status = statusFromLegendMatch(sheet, i, c0, c1, c2, legend, blockStatus)
      } else if (useFillForStatus) {
        status = statusFromApartmentCellFills(sheet, i, c0, c1, c2)
      } else {
        status = blockStatus
      }

      const spanFloors = Math.max(
        spanFloorsFromLayout(layoutTitle),
        apartmentBlockMergedAcrossNextFloorBlock(sheet, i, c0, c1, c2) ? 2 : 1
      )
      let floorOut = Math.trunc(floorN)
      let areaOut = area
      let priceOut = priceRub
      let ppmOut = ppm

      if (spanFloors === 2 && i + 5 < rows.length) {
        const nextA = rows[i + 3] || []
        const nextFloor = numOrNull(rowCell(nextA, 0))
        if (Number.isFinite(nextFloor) && nextFloor === floorN - 1) {
          // Якорь в БД — нижний этаж охвата (верх = floorOut + spanFloors - 1)
          floorOut = Math.trunc(nextFloor)
          const nextB = rows[i + 4] || []
          const nextC = rows[i + 5] || []
          const areaLower = numOrNull(rowCell(nextA, c1))
          const priceLower = numOrNull(rowCell(nextC, c2))
          const ppmLower = numOrNull(rowCell(nextB, c2))
          if (areaLower != null || priceLower != null || ppmLower != null) {
            areaOut = areaLower != null ? areaLower : areaOut
            priceOut = priceLower != null ? priceLower : priceOut
            ppmOut = ppmLower != null ? ppmLower : ppmOut
          }
        }
      }

      out.push({
        external_id: `${idPrefix}-${unitNum}`,
        number: unitNum,
        floor: floorOut,
        rooms: roomsFromLayout(layoutTitle),
        area: areaOut,
        price: priceOut,
        price_per_meter: ppmOut,
        status,
        layout_title: layoutStr || null,
        span_floors: spanFloors,
        is_commercial: false,
      })

      k += 1
    }

    if (Math.trunc(floorN) === 1) {
      const scanned = scanCommercialPremisesRow(
        sheet,
        i,
        rowA,
        rowB,
        rowC,
        maxLen,
        idPrefix,
        useLegend,
        useFillForStatus,
        legend,
        blockStatus,
        floorN
      )
      for (const item of scanned) out.push(item)
    }

    i += 3
  }

  return dedupeUnitsByExternalId(out)
}
