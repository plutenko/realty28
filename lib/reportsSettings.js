/**
 * Загрузка и сохранение настроек бота отчётов (reports_settings singleton, id=1).
 */

let cache = null
let cacheAt = 0
const TTL_MS = 30_000

export async function getReportsSettings(supabaseAdmin) {
  const now = Date.now()
  if (cache && now - cacheAt < TTL_MS) return cache
  const { data, error } = await supabaseAdmin
    .from('reports_settings')
    .select('settings')
    .eq('id', 1)
    .maybeSingle()
  if (error || !data) return null
  cache = data.settings
  cacheAt = now
  return data.settings
}

export function invalidateReportsSettingsCache() {
  cache = null
  cacheAt = 0
}

export async function saveReportsSettings(supabaseAdmin, settings) {
  const { error } = await supabaseAdmin
    .from('reports_settings')
    .update({ settings, updated_at: new Date().toISOString() })
    .eq('id', 1)
  invalidateReportsSettingsCache()
  return { ok: !error, error: error?.message }
}

/**
 * Подставляет переменные {name}/{date}/etc в шаблон.
 */
export function fillTemplate(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
  )
}

/**
 * Имена колонок daily_reports, куда пишем — белый список, чтобы случайно не писать левые поля из parser'а.
 */
export const DAILY_REPORT_COLUMNS = [
  'cold_calls',
  'leaflet',
  'activations',
  'meetings',
  'consultations',
  'repeat_touch',
  'shows_objects_count',
  'shows_objects_objects',
  'shows_objects_raw',
  'shows_clients_count',
  'shows_clients_raw',
  'ad_exclusive',
  'ad_search',
  'new_buildings_presentations',
  'deposits',
  'revenue',
  'selection',
]

export function pickDailyReportColumns(metrics) {
  const out = {}
  for (const k of DAILY_REPORT_COLUMNS) {
    if (metrics[k] !== undefined) out[k] = metrics[k]
  }
  return out
}
