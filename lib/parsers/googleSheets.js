/**
 * Парсер Google Sheets → строки квартир **только для застройщика «Содружество»**:
 * 3 строки на этаж (A/B/C), легенда статусов в AA, merged cells у двухуровневых,
 * коммерция на 1-м этаже и т.д.
 *
 * У другого застройщика другая вёрстка таблицы — нужен **отдельный модуль** парсера
 * и ветка в `parseGoogleSheetRowsByParserType` (`lib/syncGoogleSheetsFromSource.js`)
 * по полю `sources.parser_type` (например `sodruzhestvo` vs новый код).
 */
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
  // Extract number like "1.1" from "Помещение 1.1"
  const tail = s.match(/(\d+(?:[.,]\d+)?)\s*$/)
  if (tail) return tail[1].replace(',', '.')
  const any = s.match(/(\d+(?:[.,]\d+)?)/)
  if (any) return any[1].replace(',', '.')
  return null
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

/** Standard Excel indexed color palette → RGB */
const INDEXED_COLORS = [
  '000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF', // 0-7
  '000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF', // 8-15
  '800000','008000','000080','808000','800080','008080','C0C0C0','808080', // 16-23
  '9999FF','993366','FFFFCC','CCFFFF','660066','FF8080','0066CC','CCCCFF', // 24-31
  '000080','FF00FF','FFFF00','00FFFF','800080','800000','008080','0000FF', // 32-39
  '00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99', // 40-47
  '3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696', // 48-55
  '003366','339966','003300','333300','993300','993366','333399','333333', // 56-63
  '000000','FFFFFF', // 64=system fg, 65=system bg
]
function indexedToRgb(idx) {
  const hex = INDEXED_COLORS[idx]
  if (!hex) return null // unknown index → treat as no color
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  }
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
  // Resolve indexed colors to RGB and check if white
  const fgResolved = fg?.indexed != null ? indexedToRgb(fg.indexed) : null
  const bgResolved = bg?.indexed != null ? indexedToRgb(bg.indexed) : null
  if (fgResolved && !rgbIsNearWhite(fgResolved)) return false
  if (bgResolved && !rgbIsNearWhite(bgResolved)) return false

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

  // Gray patterns without explicit colors → return gray RGB
  if (pt === 'gray125') return { r: 192, g: 192, b: 192 }
  if (pt === 'darkGray') return { r: 128, g: 128, b: 128 }
  if (pt === 'lightGray') return { r: 211, g: 211, b: 211 }

  const fg = fill.fgColor
  const bg = fill.bgColor
  // Resolve from hex RGB first, then fall back to indexed palette
  const fr = hexToRgb(fg?.rgb) || (fg?.indexed != null ? indexedToRgb(fg.indexed) : null)
  const br = hexToRgb(bg?.rgb) || (bg?.indexed != null ? indexedToRgb(bg.indexed) : null)
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
 * @typedef {{ sold: Array<{ r: number, g: number, b: number }>, booked: Array<{ r: number, g: number, b: number }>, available: Array<{ r: number, g: number, b: number }> }} StatusLegendMulti
 * @typedef {{ sold: { r: number, g: number, b: number }|null, booked: { r: number, g: number, b: number }|null, available: { r: number, g: number, b: number }|null }} StatusLegend
 */

/**
 * Flexible legend finder: scans the sheet for text labels like "Продано", "Бронь", "Свободно"
 * and reads fill color from cells above/left of the label.
 */
function parseStatusLegendFlexible(sheet) {
  const legend = { sold: null, booked: null, available: null, closed: null }
  const ref = sheet['!ref']
  if (!ref) return legend
  let d
  try { d = decodeRange(ref) } catch { return legend }

  const SOLD_WORDS = ['продан', 'реализован']
  const BOOKED_WORDS = ['бронь', 'бронир', 'резерв']
  const AVAILABLE_WORDS = ['свобод', 'в продаже', 'подрядчик', 'ремонт', 'мин пв']
  const CLOSED_WORDS = ['закрыт']

  function matchStatus(text) {
    const t = text.toLowerCase()
    for (const w of SOLD_WORDS) if (t.includes(w)) return 'sold'
    for (const w of BOOKED_WORDS) if (t.includes(w)) return 'booked'
    for (const w of CLOSED_WORDS) if (t.includes(w)) return 'closed'
    for (const w of AVAILABLE_WORDS) if (t.includes(w)) return 'available'
    return null
  }

  // Scan ONLY legend area (columns 22+ / W+, rightmost part of sheet)
  // Legend labels are typically in the right margin, not in the data grid
  const legendStartCol = Math.max(22, LEGEND_COL_AA - 4) // Start from column W (22) or near AA
  const maxR = Math.min(d.e.r, 200)
  const maxC = Math.min(d.e.c, 40)
  const found = [] // { status, rgb }
  for (let R = 0; R <= maxR; R++) {
    for (let C = legendStartCol; C <= maxC; C++) {
      const cellRef = encodeCell({ r: R, c: C })
      const cell = sheet[cellRef]
      if (!cell || cell.v == null) continue
      const text = String(cell.v).trim()
      if (text.length < 3 || text.length > 30) continue
      const st = matchStatus(text)
      if (!st) continue
      // Get fill color from cells above this label (the colored block)
      // Try: same row -1 col, row-1 same col, row-2 same col, row-1 col-1
      const candidates = [
        [R - 1, C], [R - 2, C], [R - 1, C - 1], [R, C - 1],
        [R - 1, C + 1], [R - 2, C + 1], [R - 1, C + 2],
      ]
      for (const [cr, cc] of candidates) {
        if (cr < 0 || cc < 0) continue
        const rgb = fillToRgb(sheetCellFill(sheet, cr, cc))
        if (rgb && !rgbIsNearWhite(rgb)) {
          found.push({ status: st, rgb })
          break
        }
      }
    }
  }

  // Collect unique colors per status (don't average — keep each distinct color)
  const byStatus = { sold: [], booked: [], available: [], closed: [] }
  for (const f of found) {
    if (!byStatus[f.status]) byStatus[f.status] = []
    const isDupe = byStatus[f.status].some(existing => colorDistanceSq(existing, f.rgb) < 500)
    if (!isDupe) byStatus[f.status].push(f.rgb)
  }
  if (byStatus.sold.length) legend.sold = byStatus.sold[0]
  if (byStatus.booked.length) legend.booked = byStatus.booked[0]
  if (byStatus.available.length) legend.available = byStatus.available[0]
  if (byStatus.closed.length) legend.closed = byStatus.closed[0]
  legend._multi = byStatus
  return legend
}

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
  const n = [legend.sold, legend.booked, legend.available, legend.closed].filter(Boolean).length
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
  // Use unit number cell color for matching
  const numCellFill = sheetCellFill(sheet, rowA, c0)
  const numCellRgb = fillToRgb(numCellFill)
  // White/no-fill = "Свободно" (available)
  if (fillIsPlainWhite(numCellFill)) return 'available'
  if (!numCellRgb || rgbIsNearWhite(numCellRgb)) return 'available'
  // Gray = "Продажи закрыты" (even if not in legend)
  // Gray: R≈G≈B, all between 170-230
  const { r, g, b } = numCellRgb
  if (r > 170 && g > 170 && b > 170 && r < 230 && g < 230 && b < 230 &&
      Math.abs(r - g) < 10 && Math.abs(g - b) < 10 && Math.abs(r - b) < 10) return 'closed'

  const subject = numCellRgb

  // Build reference list: use multi-color legend if available, otherwise single
  /** @type {Array<{ st: 'sold'|'booked'|'available', rgb: { r: number, g: number, b: number } }>} */
  const refs = []
  const multi = legend._multi
  if (multi) {
    for (const rgb of multi.sold || []) refs.push({ st: 'sold', rgb })
    for (const rgb of multi.booked || []) refs.push({ st: 'booked', rgb })
    for (const rgb of multi.available || []) refs.push({ st: 'available', rgb })
    for (const rgb of multi.closed || []) refs.push({ st: 'closed', rgb })
  }
  if (!refs.length) {
    if (legend.sold) refs.push({ st: 'sold', rgb: legend.sold })
    if (legend.booked) refs.push({ st: 'booked', rgb: legend.booked })
    if (legend.available) refs.push({ st: 'available', rgb: legend.available })
    if (legend.closed) refs.push({ st: 'closed', rgb: legend.closed })
  }
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
  // Scan all 3 rows (A, B, C) for "помещение" labels (not "коммерц" — that's just a category label)
  const blockRows = [rowA, rowB, rowC]
  const seenLabels = new Set()
  for (let ri = 0; ri < blockRows.length; ri++) {
    const scanRow = blockRows[ri]
    for (let c = 1; c < maxLen; c += 1) {
      const cellText = normStr(rowCell(scanRow, c)).toLowerCase()
      if (!cellText.includes('помещение')) continue
      const label = normStr(rowCell(scanRow, c))
      if (seenLabels.has(label)) continue
      seenLabels.add(label)

      // Collect area from row A nearby, price from row C, ppm from row B
      // (same structure as regular apartments: A=data, B=ppm, C=price)
      // Commercial premises may span merged cells, so search up to 6 cols
      // but stop if we hit another "помещение" label (next premise)
      let area = null
      let price = null
      let ppmVal = null
      const searchEnd = Math.min(c + 7, maxLen)

      // Find next "помещение" label to limit search scope
      let nextLabelCol = searchEnd
      for (let j = c + 1; j < searchEnd; j++) {
        for (const sr of blockRows) {
          if (normStr(rowCell(sr, j)).toLowerCase().includes('помещение')) {
            nextLabelCol = j
            break
          }
        }
        if (nextLabelCol < searchEnd) break
      }

      // Area: small number in row A near the label
      for (let j = c; j < nextLabelCol && j < rowA.length; j++) {
        const n = numOrNull(rowCell(rowA, j))
        if (n != null && n > 0 && n < 10000 && area === null) area = n
      }
      // Price (total): largest number in row C near the label
      for (let j = c; j < nextLabelCol && j < rowC.length; j++) {
        const n = numOrNull(rowCell(rowC, j))
        if (n != null && n >= 10000 && (price === null || n > price)) price = n
      }
      // PPM: number in row B near the label
      for (let j = c; j < nextLabelCol && j < rowB.length; j++) {
        const n = numOrNull(rowCell(rowB, j))
        if (n != null && n >= 10000 && ppmVal === null) ppmVal = n
      }
      if (area === null && price === null) continue

      let statusComm
      if (useLegend) {
        statusComm = statusFromLegendMatch(sheet, rowIndex + ri, c, c + 1, c + 2, legend, blockStatus)
      } else if (useFillForStatus) {
        statusComm = statusFromApartmentCellFills(sheet, rowIndex + ri, c, c + 1, c + 2)
      } else {
        statusComm = blockStatus
      }

      // Position from column: apartments use groups of 3 cols starting at col 1
      const commPosition = c >= 1 ? Math.floor((c - 1) / 3) + 1 : 1

      found.push({
        external_id: `${idPrefix}-comm-f${Math.trunc(floorN)}-${label}-${c}`,
        number: numberFromCommercialLabel(rowCell(scanRow, c)) ?? 0,
        floor: Math.trunc(floorN),
        rooms: null,
        area,
        price,
        price_per_meter: ppmVal,
        status: statusComm,
        layout_title: label || 'Коммерция',
        span_floors: 1,
        is_commercial: true,
        commercial_label: label || 'Коммерция',
        position: commPosition,
      })
    }
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

  // Try flexible legend first (scans for "Продано", "Бронь", "Свободно" etc.)
  let legend = parseStatusLegendFlexible(sheet)
  let useLegend = legendIsUsable(legend)
  // Fallback: fixed column AA legend (old Содружество format)
  if (!useLegend) {
    legend = parseStatusLegendFromColumnAA(sheet)
    useLegend = legendIsUsable(legend)
  }
  const useFillForStatus = !useLegend && sheetHasDistinctFills(sheet)

  console.log(`[parseChessboard] sheet="${name}" useLegend=${useLegend} useFillForStatus=${useFillForStatus}`, useLegend ? { legend } : {})
  let debuggedFills = false

  const idPrefix = name || 'sheet'
  const out = []

  let i = 0
  while (i + 2 < rows.length) {
    const rowA = rows[i] || []
    const floorN = numOrNull(rowCell(rowA, 0))
    if (!Number.isFinite(floorN) || floorN < 1 || floorN > 60) {
      // Check if this non-floor row contains commercial premises
      for (let c = 0; c < rowA.length; c++) {
        const cellText = normStr(rowCell(rowA, c)).toLowerCase()
        if (!cellText.includes('помещение')) continue
        const label = normStr(rowCell(rowA, c))
        let area = null
        const bigNums = []
        // Search same row and rows below for area/price
        for (let j = c + 1; j < Math.min(rowA.length, c + 15); j++) {
          const n = numOrNull(rowCell(rowA, j))
          if (n != null && area === null && n < 10000) area = n
          if (n != null && n >= 10000) bigNums.push(n)
        }
        for (let ri = i + 1; ri < Math.min(i + 3, rows.length); ri++) {
          const belowRow = rows[ri] || []
          for (let j = Math.max(0, c - 2); j < Math.min(belowRow.length, c + 15); j++) {
            const n = numOrNull(rowCell(belowRow, j))
            if (n != null && n >= 10000) bigNums.push(n)
          }
        }
        bigNums.sort((a, b) => b - a)
        const price = bigNums[0] ?? null
        const ppm = bigNums.length > 1 ? bigNums[1] : null

        if (area != null || price != null) {
          let status = 'available'
          if (useLegend) {
            const numFill = sheetCellFill(sheet, i, c)
            const numRgb = fillToRgb(numFill)
            if (!fillIsPlainWhite(numFill) && numRgb && !rgbIsNearWhite(numRgb)) {
              status = statusFromLegendMatch(sheet, i, c, c + 1, c + 2, legend, 'available')
            }
          }
          const commPos = c >= 1 ? Math.floor((c - 1) / 3) + 1 : 1
          out.push({
            external_id: `${idPrefix}-comm-r${i}-c${c}`,
            number: numberFromCommercialLabel(rowCell(rowA, c)) ?? 0,
            floor: 1,
            rooms: null,
            area,
            price,
            price_per_meter: ppm,
            status,
            layout_title: label || 'Коммерция',
            span_floors: 1,
            is_commercial: true,
            commercial_label: label || 'Коммерция',
            position: commPos,
          })
        }
        break
      }
      i += 1
      continue
    }

    const rowB = rows[i + 1] || []
    const rowC = rows[i + 2] || []

    // Debug: log fills for first floor's first apartment
    if (!debuggedFills) {
      debuggedFills = true
      const dbgCells = [[i, 1], [i, 2], [i, 3], [i+1, 3], [i+2, 3]]
      for (const [r, c] of dbgCells) {
        const ref = encodeCell({ r, c })
        const cell = sheet[ref]
        const fill = cell?.s
        const isWhite = fillIsPlainWhite(fill)
        const rgb = fillToRgb(fill)
        console.log(`[parseChessboard] DEBUG floor=${floorN} cell ${ref} val=${cell?.v} fill=${JSON.stringify(fill)} isWhite=${isWhite} rgb=${JSON.stringify(rgb)}`)
      }
    }
    // Debug floor 16 fills specifically
    if (Math.trunc(floorN) === 16) {
      const dbgCells16 = [[i, 1], [i, 2], [i, 3]]
      for (const [r, c] of dbgCells16) {
        const ref = encodeCell({ r, c })
        const cell = sheet[ref]
        const fill = cell?.s
        const rgb = fillToRgb(fill)
        console.log(`[parseChessboard] FLOOR16 cell ${ref} val=${cell?.v} fill=${JSON.stringify(fill)} isWhite=${fillIsPlainWhite(fill)} rgb=${JSON.stringify(rgb)}`)
      }
    }

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
    const inlineCommercialLabels = new Set()
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
          c1Lower.includes('помещение'))

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

        inlineCommercialLabels.add(normStr(unitRaw).toLowerCase())

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

      // Debug fill for high floors
      let _fillDebug = undefined
      if (floorOut >= 16 && k === 0) {
        const numFill = sheetCellFill(sheet, i, c0)
        const numRgb = fillToRgb(numFill)
        _fillDebug = {
          rawFill: JSON.stringify(numFill),
          isWhite: fillIsPlainWhite(numFill),
          rgb: numRgb,
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
        position: k + 1,
        _fillDebug,
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
      for (const item of scanned) {
        // Skip if already found by inline detection (exact column positions are more reliable)
        const label = normStr(item.commercial_label).toLowerCase()
        if (inlineCommercialLabels.has(label)) continue
        out.push(item)
      }
    }

    i += 3
  }

  // Scan remaining rows below all floors for commercial premises
  // (some sheets put commercial below the last floor block, not inside floor 1)
  console.log(`[parseChessboard] scanning for commercial from row ${i}, total rows: ${rows.length}`)
  while (i < rows.length) {
    const row = rows[i] || []
    for (let c = 0; c < row.length; c++) {
      const cellText = normStr(rowCell(row, c)).toLowerCase()
      if (!cellText.includes('помещение') && !cellText.includes('коммерц')) continue
      console.log(`[parseChessboard] found commercial label at row ${i}, col ${c}: "${cellText}"`)


      // Found commercial label — scan nearby cells for area and price
      let area = null
      let price = null
      let ppm = null
      let label = normStr(rowCell(row, c))

      // Search same row and rows below for area/price
      for (let j = c + 1; j < Math.min(row.length, c + 10); j++) {
        const n = numOrNull(rowCell(row, j))
        if (n != null && area === null && n < 10000) area = n
        if (n != null && n >= 10000) { if (!price) price = n; else if (!ppm) ppm = n }
      }
      // Check rows below
      for (let ri = i + 1; ri < Math.min(i + 3, rows.length); ri++) {
        const belowRow = rows[ri] || []
        for (let j = c; j < Math.min(belowRow.length, c + 10); j++) {
          const n = numOrNull(rowCell(belowRow, j))
          if (n != null && n >= 10000 && !price) price = n
          if (n != null && n >= 10000 && price && !ppm && n !== price) ppm = n
        }
      }

      if (area != null || price != null) {
        let status
        if (useLegend) {
          const numFill = sheetCellFill(sheet, i, c)
          const numRgb = fillToRgb(numFill)
          if (fillIsPlainWhite(numFill) || !numRgb || rgbIsNearWhite(numRgb)) {
            status = 'available'
          } else {
            status = statusFromLegendMatch(sheet, i, c, c + 1, c + 2, legend, 'available')
          }
        } else if (useFillForStatus) {
          status = statusFromApartmentCellFills(sheet, i, c, c + 1, c + 2)
        } else {
          status = 'available'
        }

        out.push({
          external_id: `${idPrefix}-comm-r${i}-c${c}`,
          number: numberFromCommercialLabel(rowCell(row, c)) ?? 0,
          floor: 1,
          rooms: null,
          area,
          price,
          price_per_meter: ppm,
          status,
          layout_title: label || 'Коммерция',
          span_floors: 1,
          is_commercial: true,
          commercial_label: label || 'Коммерция',
        })
      }
      break // one commercial block per row
    }
    i++
  }

  return dedupeUnitsByExternalId(out)
}
