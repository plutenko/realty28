/**
 * Компилирует Excel-шахматки ЖК «Лазурный берег» в lib/lazurLayouts.json.
 * Запуск: `node scripts/buildLazurLayouts.mjs`
 *
 * Excel — только источник структуры дома (этажность, число квартир на этаже,
 * позиция квартиры в подъезде). Сами квартиры (цены, наличие) берутся с сайта
 * Tilda Store. Парсер сверяет (entrance, floor, number) с этой раскладкой,
 * чтобы рассчитать глобальную позицию в шахматке.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SEED_DIR = path.join(__dirname, 'seed', 'lazur')
const OUT_FILE = path.join(__dirname, '..', 'lib', 'lazurLayouts.json')

const CONFIG = {
  l7: {
    // Сданный 4/5 — Excel-шахматки нет, на сайте всего 2 квартиры (№76 и
    // №179). skipExcel=true — парсер Excel пропускает, в layouts попадает
    // минимальный конфиг с storepart/recid, чтобы sync находил литер.
    skipExcel: true,
    building_id: 'd5b75303-f1d2-4b6a-8307-645282f53a60',
    storepart: '176651611922',
    recid: '765850512',
    tab_label: 'Сданный 4/5',
    floors: 14,
    entrances: 2,
  },
  l9: {
    file: 'liter-9.xlsx',
    sheet: '10.05.2023',
    building_id: 'bae1c6a5-a5d5-4358-b016-194c710be4dd',
    storepart: '192173273262',
    recid: '1628454181',
    tab_label: 'Сданный 4/6',
  },
  l9oc2: {
    file: 'liter-9-och-2.xlsx',
    sheet: 'Лист1',
    building_id: 'b8ff0df5-d388-40af-9bb1-61ef0b3ba5dd',
    storepart: '444729551372',
    recid: '1633730321',
    tab_label: 'Литер 2 (15 эт.)',
    forceEntrance: 1,
  },
  l10: {
    file: 'liter-10.xlsx',
    sheet: 'Лист1',
    building_id: '4678b62d-aced-4349-a4c9-6d291abfe419',
    storepart: '242781962772',
    recid: '670767243',
    tab_label: 'Литер 10 (25 эт.)',
    forceEntrance: 1,
    // Excel содержит только этажи с квартирами (верхние строятся). Шахматка
    // отображается на всю высоту дома — фактические 25 этажей.
    floorsOverride: 25,
  },
}

function roomsFromLabel(label) {
  const s = String(label || '').toLowerCase()
  if (!s) return null
  if (s.includes('студ')) return 0
  const m = s.match(/(\d)\s*к/)
  return m ? Number(m[1]) : null
}

function parseNum(cell) {
  // В Excel у застройщика встречается «№ 175», «Кв 166», «кв 176», «кв.176».
  const m = String(cell ?? '').match(/(?:№|[Кк]в\.?)\s*(\d+)/)
  return m ? Number(m[1]) : null
}

function parseArea(cell) {
  const m = String(cell ?? '').replace(',', '.').match(/(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : null
}

function parseLayout(cfg) {
  const buf = fs.readFileSync(path.join(SEED_DIR, cfg.file))
  const wb = XLSX.read(buf, { type: 'buffer' })
  const ws = wb.Sheets[cfg.sheet]
  if (!ws) throw new Error(`Sheet ${cfg.sheet} not found in ${cfg.file}`)
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })

  // Первый проход — собираем номера/area/header/entrance, без span
  const raw = [] // [{entrance, floor, col, num, raw, rooms, area}]
  let currentEntrance = cfg.forceEntrance ?? null
  let header = null
  let i = 0
  while (i < rows.length) {
    const row = rows[i] || []
    for (const v of row) {
      const m = String(v ?? '').match(/[Пп]одъезд\s+(\d+)/)
      if (m) currentEntrance = Number(m[1])
    }
    const first = row[0]
    if (first != null && /[Ээ]таж/.test(String(first))) {
      header = row
      i += 1
      continue
    }
    const floorRaw = Number(first)
    if (Number.isFinite(floorRaw) && floorRaw === Math.floor(floorRaw) && floorRaw >= 1 && floorRaw <= 30) {
      const floor = floorRaw
      const areaRow = rows[i + 1] || []
      for (let col = 1; col < row.length; col++) {
        const num = parseNum(row[col])
        if (num == null) continue
        const rawCell = String(row[col] ?? '')
        let rooms = roomsFromLabel(header?.[col])
        if (/\(\s*3\s*к/.test(rawCell)) rooms = 3
        const area = parseArea(areaRow[col])
        raw.push({ entrance: currentEntrance ?? 1, floor, col, num, rooms, area })
      }
      i += 4
      continue
    }
    i += 1
  }

  // Ширина каждого подъезда = макс col по всем этажам
  const maxColByEntrance = new Map()
  for (const r of raw) {
    const cur = maxColByEntrance.get(r.entrance) ?? 0
    if (r.col > cur) maxColByEntrance.set(r.entrance, r.col)
  }

  // Второй проход — span. Трёшки ≥ ~90 м² занимают 2 колонки (правило Л9
  // 14-й этаж). Последние квартиры подъезда span=1 — не перекрывают пустоту
  // справа от торца подъезда.
  const positions = {}
  const byEntranceFloor = new Map() // "ent:fl" -> sorted cols
  for (const r of raw) {
    const k = `${r.entrance}:${r.floor}`
    if (!byEntranceFloor.has(k)) byEntranceFloor.set(k, [])
    byEntranceFloor.get(k).push(r.col)
  }
  for (const arr of byEntranceFloor.values()) arr.sort((a, b) => a - b)

  for (const r of raw) {
    const cols = byEntranceFloor.get(`${r.entrance}:${r.floor}`)
    const idx = cols.indexOf(r.col)
    const nextCol = cols[idx + 1] ?? (maxColByEntrance.get(r.entrance) + 1)
    let span = Math.max(1, Math.min(nextCol - r.col, maxColByEntrance.get(r.entrance) - r.col + 1))
    // Узкие квартиры (1-к / студии / 2-к) никогда не занимают больше 1 ячейки,
    // даже если столбец справа пуст на этом этаже (у соседа просто другая
    // конфигурация, а не физическое расширение комнаты).
    if (r.rooms !== 3 && !(r.rooms == null && r.area && r.area >= 90)) {
      span = 1
    }
    const key = `${r.entrance}-${r.floor}-${r.num}`
    positions[key] = {
      col: r.col,
      span_columns: span,
      rooms: r.rooms,
      area: r.area,
    }
  }

  const entrances = [...maxColByEntrance.keys()].sort((a, b) => a - b)
  const unitsPerEntrance = entrances.map((e) => maxColByEntrance.get(e))
  const unitsPerFloor = unitsPerEntrance.reduce((s, v) => s + v, 0)
  const floorsFromData = Math.max(0, ...raw.map((r) => r.floor))
  const floorsCount = cfg.floorsOverride ?? floorsFromData

  return {
    building_id: cfg.building_id,
    storepart: cfg.storepart,
    recid: cfg.recid,
    tab_label: cfg.tab_label,
    floors: floorsCount,
    floors_in_data: floorsFromData,
    entrances: entrances.length,
    units_per_floor: unitsPerFloor,
    units_per_entrance: unitsPerEntrance,
    positions,
  }
}

const out = {}
for (const slug of Object.keys(CONFIG)) {
  const cfg = CONFIG[slug]
  if (cfg.skipExcel) {
    out[slug] = {
      building_id: cfg.building_id,
      storepart: cfg.storepart,
      recid: cfg.recid,
      tab_label: cfg.tab_label,
      floors: cfg.floors ?? null,
      entrances: cfg.entrances ?? 1,
      units_per_floor: cfg.units_per_floor ?? null,
      units_per_entrance: cfg.units_per_entrance ?? null,
      positions: {},
    }
    console.log(
      `${slug}: skipExcel (building=${cfg.building_id}  floors=${cfg.floors}  entrances=${cfg.entrances})`
    )
    continue
  }
  const lay = parseLayout(cfg)
  console.log(
    `${slug}: building=${lay.building_id}  floors=${lay.floors}  upf=${lay.units_per_floor}  upe=${JSON.stringify(lay.units_per_entrance)}  positions=${Object.keys(lay.positions).length}`
  )
  out[slug] = lay
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2))
console.log(`\nWrote ${OUT_FILE}`)
