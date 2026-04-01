/**
 * Печатает команды npm run db:migrate:skip для каждого .sql
 * (если нужно разом отметить уже применённые миграции на старой БД).
 *
 * npm run db:migrate:list-skip
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const dir = path.join(root, 'supabase', 'migrations')
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  : []

console.log('# Выполняйте только если схема уже соответствует файлам (иначе сломаете журнал):\n')
for (const f of files) {
  console.log(`npm run db:migrate:skip -- ${f}`)
}
