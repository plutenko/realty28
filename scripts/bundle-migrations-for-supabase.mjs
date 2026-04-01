/**
 * Собирает все supabase/migrations/*.sql в один файл для вставки в
 * Supabase → SQL Editor (без пароля БД в терминале).
 *
 * npm run db:migrate:bundle
 *
 * Результат: supabase/paste-migrations-supabase-sql-editor.sql
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const outFile = path.join(root, 'supabase', 'paste-migrations-supabase-sql-editor.sql')

const HEADER = `-- =============================================================================
-- Собрано скриптом: npm run db:migrate:bundle
-- Вставка: Supabase Dashboard → SQL Editor → New query → вставить файл → Run
--
-- ВАЖНО: блок 001_newbuildings.sql УДАЛЯЕТ таблицы (DROP). Если база уже с данными,
--   удалите из этого файла всё от -- >>> BEGIN: 001_newbuildings.sql до -- <<< END: 001_newbuildings.sql
--
-- Миграция 023 удаляет устаревшие таблицы OAuth (если были).
--
-- После ручного Run журнал schema_migrations npm не знает — при необходимости:
--   npm run db:migrate:skip -- <имя_файла.sql>
-- =============================================================================

`

function main() {
  if (!fs.existsSync(migrationsDir)) {
    console.error('Нет каталога:', migrationsDir)
    process.exit(1)
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  if (!files.length) {
    console.error('В migrations нет .sql файлов')
    process.exit(1)
  }

  const chunks = [HEADER]
  for (const name of files) {
    const full = path.join(migrationsDir, name)
    const body = fs.readFileSync(full, 'utf8').trimEnd()
    chunks.push(`\n-- >>> BEGIN: ${name}\n`)
    chunks.push(body)
    chunks.push(`\n\n-- <<< END: ${name}\n`)
  }

  fs.writeFileSync(outFile, chunks.join(''), 'utf8')
  console.log('Записано:', outFile)
  console.log('Файлов:', files.length)
}

main()
