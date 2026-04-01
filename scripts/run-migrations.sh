#!/usr/bin/env bash
# Применить все SQL-миграции к Supabase Postgres (с вашей машины, пароль только в .env.local).
#
# Использование:
#   chmod +x scripts/run-migrations.sh   # один раз
#   ./scripts/run-migrations.sh
#
# Нужно в корне проекта: .env.local с DATABASE_URL или SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.local ]] && [[ ! -f .env ]]; then
  echo "Ошибка: нет .env.local (или .env)."
  echo "Добавьте DATABASE_URL или NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD"
  echo "(пароль БД: Supabase → Project Settings → Database)."
  exit 1
fi

echo "Запуск миграций из supabase/migrations/ …"
exec node scripts/apply-db-migrations.mjs
