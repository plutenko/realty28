/**
 * Помечает миграцию как уже применённую (без выполнения SQL).
 * Нужно, если схема создана вручную / ошибка «already exists» / не хотите гонять 001 на живой БД.
 *
 * npm run db:migrate:skip -- 001_newbuildings.sql
 * npm run db:migrate:skip -- 020_sources_parser_sheet_sync_meta.sql
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

async function main() {
  const filename = process.argv[2]
  if (!filename || !filename.endsWith('.sql')) {
    console.error('Укажите имя файла миграции, например:')
    console.error('  npm run db:migrate:skip -- 020_sources_parser_sheet_sync_meta.sql')
    process.exit(1)
  }

  const full = path.join(root, 'supabase', 'migrations', filename)
  if (!fs.existsSync(full)) {
    console.error('Файл не найден:', full)
    process.exit(1)
  }

  const DATABASE_URL = buildDatabaseUrl()
  if (!DATABASE_URL) {
    console.error('Нет DATABASE_URL / SUPABASE_DB_PASSWORD в .env.local')
    process.exit(1)
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `)
    await client.query(
      `INSERT INTO public.schema_migrations (filename) VALUES ($1)
       ON CONFLICT (filename) DO UPDATE SET applied_at = now()`,
      [filename]
    )
    console.log('Отмечено как применённое:', filename)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
