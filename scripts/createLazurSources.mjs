/**
 * Одноразовая инициализация источников ЖК «Лазурный берег».
 * Читает lib/lazurLayouts.json и для каждого литера:
 *   1) обновляет buildings.floors / units_per_floor / units_per_entrance
 *   2) создаёт sources(type='lazurnyy_bereg', url=<slug>) если ещё нет
 *
 * Запуск: `node scripts/createLazurSources.mjs`
 * (требует .env.local с SUPABASE_SERVICE_ROLE_KEY)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

// --- загрузить env из .env.local
const envPath = path.join(ROOT, '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) {
      let val = m[2]
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      process.env[m[1]] = val
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Не найдены NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const layouts = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'lib', 'lazurLayouts.json'), 'utf8')
)

const SB_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
}

async function sbGet(query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, { headers: SB_HEADERS })
  if (!r.ok) throw new Error(`GET ${query}: ${r.status} ${await r.text()}`)
  return r.json()
}

async function sbPatch(query, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`PATCH ${query}: ${r.status} ${await r.text()}`)
  return r.json()
}

async function sbPost(query, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`POST ${query}: ${r.status} ${await r.text()}`)
  return r.json()
}

for (const [slug, lay] of Object.entries(layouts)) {
  console.log(`\n=== ${slug}  (building_id=${lay.building_id}) ===`)

  // 1. Обновить метаданные здания
  const bUpd = {
    floors: lay.floors,
    units_per_floor: lay.units_per_floor,
    units_per_entrance: lay.units_per_entrance,
  }
  try {
    await sbPatch(`buildings?id=eq.${lay.building_id}`, bUpd)
    console.log(`  building updated:`, bUpd)
  } catch (e) {
    // колонки units_per_entrance может не быть в старых БД — повторяем без неё
    if (/units_per_entrance/i.test(e.message)) {
      delete bUpd.units_per_entrance
      await sbPatch(`buildings?id=eq.${lay.building_id}`, bUpd)
      console.log(`  building updated (без units_per_entrance):`, bUpd)
    } else {
      throw e
    }
  }

  // 2. Найти существующий source или создать новый
  const existing = await sbGet(
    `sources?building_id=eq.${lay.building_id}&type=eq.lazurnyy_bereg&select=id,url`
  )
  if (existing.length > 0) {
    // Обновим url (вдруг менялся storepart/recid)
    if (existing[0].url !== slug) {
      await sbPatch(`sources?id=eq.${existing[0].id}`, { url: slug })
      console.log(`  source updated: id=${existing[0].id} url=${slug}`)
    } else {
      console.log(`  source exists: id=${existing[0].id} url=${slug}`)
    }
  } else {
    const created = await sbPost('sources', [
      {
        type: 'lazurnyy_bereg',
        building_id: lay.building_id,
        url: slug,
      },
    ])
    console.log(`  source created: id=${created[0]?.id} url=${slug}`)
  }
}

console.log('\nГотово.')
