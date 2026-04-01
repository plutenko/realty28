/**
 * Применить одну миграцию из supabase/migrations/ и записать в schema_migrations.
 *
 * npm run db:migrate:one -- 020_sources_parser_sheet_sync_meta.sql
 *
 * .env.local: DATABASE_URL или NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD
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

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `)
}

async function isApplied(client, filename) {
  const r = await client.query(
    'SELECT 1 FROM public.schema_migrations WHERE filename = $1',
    [filename]
  )
  return r.rowCount > 0
}

async function main() {
  const filename = process.argv[2]
  const force = process.argv.includes('--force')

  if (!filename || !filename.endsWith('.sql')) {
    console.error('Использование:')
    console.error('  npm run db:migrate:one -- 020_sources_parser_sheet_sync_meta.sql')
    console.error('')
    console.error('Если миграция уже в журнале, повторно не выполняется. Принудительно: добавьте --force')
    process.exit(1)
  }

  const full = path.join(root, 'supabase', 'migrations', filename)
  if (!fs.existsSync(full)) {
    console.error('Файл не найден:', full)
    process.exit(1)
  }

  const DATABASE_URL = buildDatabaseUrl()
  if (!DATABASE_URL) {
    console.error(
      'В .env.local укажите DATABASE_URL или пару NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD\n' +
        '(пароль пользователя postgres из Supabase → Settings → Database).'
    )
    process.exit(1)
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  try {
    await ensureMigrationsTable(client)

    if ((await isApplied(client, filename)) && !force) {
      console.log('Уже применено (есть в schema_migrations):', filename)
      console.log('Повторить SQL: node scripts/apply-one-migration.mjs', filename, '--force')
      return
    }

    const sql = fs.readFileSync(full, 'utf8').trim()
    if (!sql) {
      console.error('Пустой файл:', filename)
      process.exit(1)
    }

    if (filename === '001_newbuildings.sql' && !force) {
      const { rows: ex } = await client.query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'complexes'
        ) AS ex`
      )
      if (ex[0]?.ex) {
        console.log(
          'Таблица complexes уже есть — 001 не выполняю (DROP опасен). Помечаю как применённую.'
        )
        await client.query(
          'INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
          [filename]
        )
        return
      }
      console.warn('⚠️  001_newbuildings.sql удаляет старые таблицы. Убедитесь, что это нужно.\n')
    }

    if (force && (await isApplied(client, filename))) {
      await client.query('DELETE FROM public.schema_migrations WHERE filename = $1', [filename])
      console.log('Снята отметка в журнале (--force), выполняю SQL…')
    }

    console.log('Выполняю:', filename)
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query(
        `INSERT INTO public.schema_migrations (filename) VALUES ($1)
         ON CONFLICT (filename) DO UPDATE SET applied_at = now()`,
        [filename]
      )
      await client.query('COMMIT')
      console.log('Готово.')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    }
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
