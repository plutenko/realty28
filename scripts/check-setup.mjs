/**
 * Проверка окружения и БД после миграций (без правок данных).
 *
 * npm run check:setup
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Client } from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

function loadEnvFile(rel) {
  const full = path.join(root, rel)
  if (!fs.existsSync(full)) return
  const raw = fs.readFileSync(full, 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    let val = m[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadEnvFile('.env.local')
loadEnvFile('.env')

function buildDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const pass = process.env.SUPABASE_DB_PASSWORD
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!pass || !publicUrl) return null
  let host
  try {
    host = new URL(publicUrl).hostname
  } catch {
    return null
  }
  if (!host.endsWith('.supabase.co')) return null
  const projectRef = host.replace('.supabase.co', '')
  return `postgresql://postgres:${encodeURIComponent(pass)}@db.${projectRef}.supabase.co:5432/postgres`
}

function listSqlMigrations() {
  const dir = path.join(root, 'supabase', 'migrations')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

function mask(v) {
  if (!v) return '(нет)'
  if (v.length < 8) return '***'
  return `${v.slice(0, 4)}…${v.slice(-4)}`
}

async function main() {
  console.log('=== Проверка окружения ===\n')

  const pairs = [
    ['NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
    ['DATABASE_URL / SUPABASE_DB_PASSWORD', buildDatabaseUrl() ? 'задано' : ''],
  ]

  for (const [k, v] of pairs) {
    const ok = Boolean(v)
    console.log(`${ok ? '✓' : '✗'} ${k}: ${ok ? (k.includes('KEY') ? mask(String(v)) : String(v).slice(0, 60)) : '(нет)'}`)
  }

  const sa = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  console.log(
    `\nGoogle Sheets (шахматка): ${sa ? 'GOOGLE_SERVICE_ACCOUNT_JSON задан' : 'нет (нужен для Drive/Sheets API)'}`
  )

  const DATABASE_URL = buildDatabaseUrl()
  if (!DATABASE_URL) {
    console.log('\n=== БД: пропуск (нет подключения) ===')
    console.log('Добавьте DATABASE_URL или SUPABASE_DB_PASSWORD для проверки таблиц.')
    return
  }

  console.log('\n=== Проверка PostgreSQL ===\n')

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  try {
    const tables = [
      'sources',
      'profitbase_settings',
      'schema_migrations',
    ]

    for (const t of tables) {
      const r = await client.query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        )`,
        [t]
      )
      const ex = r.rows[0].exists
      console.log(`${ex ? '✓' : '✗'} таблица public.${t}`)
    }

    const files = listSqlMigrations()
    let applied = []
    try {
      const r = await client.query(
        'SELECT filename FROM public.schema_migrations ORDER BY filename'
      )
      applied = r.rows
    } catch {
      console.log('✗ таблица schema_migrations — выполните npm run db:migrate')
    }
    const appliedSet = new Set(applied.map((x) => x.filename))
    const pending = files.filter((f) => !appliedSet.has(f))

    console.log(`\nМиграции на диске: ${files.length}, в журнале: ${applied.length}`)
    if (pending.length) {
      console.log('Не применены (npm run db:migrate):')
      for (const f of pending) console.log(`  - ${f}`)
    } else if (applied.length) {
      console.log('Все файлы из supabase/migrations отмечены в schema_migrations.')
    }
  } finally {
    await client.end()
  }

  console.log('\n=== Ручные шаги ===')
  console.log('1. Google Cloud: сервисный аккаунт + JSON ключ → GOOGLE_SERVICE_ACCOUNT_JSON в .env.')
  console.log('2. Таблицу расшарить на client_email сервисного аккаунта (Viewer).')
  console.log('')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
