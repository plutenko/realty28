import { getSupabaseAdmin } from './supabaseServer'

const CACHE_MS = 60_000
let cache = { at: 0, value: null }

export function profitbaseSettingsFromEnv() {
  const accountId =
    (process.env.PROFITBASE_SSO_TENANT_ID ||
      process.env.NEXT_PUBLIC_PROFITBASE_ACCOUNT_ID ||
      '')?.trim() || ''
  const siteWidgetReferer = (process.env.PROFITBASE_SITE_WIDGET_REFERER || '').trim()
  const pbApiKey =
    (
      process.env.PROFITBASE_WIDGET_PB_API_KEY ||
      process.env.NEXT_PUBLIC_PROFITBASE_PB_API_KEY ||
      ''
    ).trim()
  const pbDomain = (process.env.PROFITBASE_PB_DOMAIN || 'profitbase.ru')
    .replace(/^\.+/, '')
    .trim()
  return {
    accountId,
    siteWidgetReferer,
    pbApiKey,
    pbDomain: pbDomain || 'profitbase.ru',
  }
}

export async function getProfitbaseSettings() {
  // 1) DB settings (admin-editable)
  try {
    if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value
    const supabase = getSupabaseAdmin()
    if (supabase) {
      const { data, error } = await supabase
        .from('profitbase_settings')
        .select('account_id, site_widget_referer, pb_api_key, pb_domain')
        .eq('id', 1)
        .maybeSingle()
      if (!error && data) {
        const value = {
          accountId: String(data.account_id || '').trim(),
          siteWidgetReferer: String(data.site_widget_referer || '').trim(),
          pbApiKey: String(data.pb_api_key || '').trim(),
          pbDomain: String(data.pb_domain || 'profitbase.ru').replace(/^\.+/, '').trim() || 'profitbase.ru',
        }
        cache = { at: Date.now(), value }
        // if DB empty, still fallback
        if (value.accountId || value.siteWidgetReferer || value.pbApiKey) return value
      }
    }
  } catch {
    // ignore, fallback to env
  }

  // 2) env fallback
  const env = profitbaseSettingsFromEnv()
  cache = { at: Date.now(), value: env }
  return env
}

