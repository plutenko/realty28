/**
 * Применяет все SQL из supabase/migrations/*.sql по имени (001…022…).
 * Учёт в public.schema_migrations — каждый файл выполняется один раз.
 *
 * Важно: 001_newbuildings.sql удаляет старые таблицы. На живой БД не запускайте
 * повторно; если схема уже есть — отметьте файл: npm run db:migrate:skip -- 001_newbuildings.sql
 *
 * DATABASE_URL или NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD в .env.local
 *
 * Запуск: npm run db:migrate
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
  const encoded = encodeURIComponent(pass)
  return `postgresql://postgres:${encoded}@db.${projectRef}.supabase.co:5432/postgres`
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `)
}

async function listMigrationFiles() {
  const dir = path.join(root, 'supabase', 'migrations')
  if (!fs.existsSync(dir)) {
    console.error('Нет каталога:', dir)
    return []
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

async function isApplied(client, filename) {
  const r = await client.query(
    'SELECT 1 FROM public.schema_migrations WHERE filename = $1',
    [filename]
  )
  return r.rowCount > 0
}

async function main() {
  const DATABASE_URL = buildDatabaseUrl()
  if (!DATABASE_URL) {
    console.error(
      'Задайте в .env.local DATABASE_URL (Supabase → Settings → Database → URI)\n' +
        'или NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD (пароль БД postgres).'
    )
    process.exit(1)
  }

  const files = await listMigrationFiles()
  if (!files.length) {
    console.error('В supabase/migrations нет .sql файлов.')
    process.exit(1)
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })

  await client.connect()
  try {
    await ensureMigrationsTable(client)

    let processedNew = 0
    let skipped = 0

    for (const filename of files) {
      const full = path.join(root, 'supabase', 'migrations', filename)
      if (await isApplied(client, filename)) {
        console.log('Уже применено:', filename)
        skipped += 1
        continue
      }

      const sql = fs.readFileSync(full, 'utf8').trim()
      if (!sql) {
        console.warn('Пустой файл, помечаю как применённый:', filename)
        await client.query(
          'INSERT INTO public.schema_migrations (filename) VALUES ($1)',
          [filename]
        )
        processedNew += 1
        continue
      }

      if (filename === '001_newbuildings.sql') {
        const { rows: ex } = await client.query(
          `SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'complexes'
          ) AS ex`
        )
        if (ex[0]?.ex) {
          console.log(
            '001 пропущен: таблица public.complexes уже есть (не гоняем DROP). Помечаю как применённую.'
          )
          await client.query(
            'INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
            [filename]
          )
          processedNew += 1
          continue
        }
        console.warn(
          '\n⚠️  001_newbuildings.sql — удаляет старые таблицы (DROP). Пустая БД или бэкап.\n'
        )
      }

      console.log('Выполняю:', filename)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(
          'INSERT INTO public.schema_migrations (filename) VALUES ($1)',
          [filename]
        )
        await client.query('COMMIT')
        console.log('  OK')
        processedNew += 1
      } catch (e) {
        await client.query('ROLLBACK')
        console.error('\nОшибка в', filename + ':', e.message)
        console.error(
          '\nЕсли объект «уже существует», отметьте миграцию без повторного SQL:\n' +
            `  npm run db:migrate:skip -- ${filename}\n`
        )
        throw e
      }
    }

    console.log(
      `\nГотово. Новых записей в журнале: ${processedNew}, уже было: ${skipped}. Файлов в каталоге: ${files.length}.`
    )
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
