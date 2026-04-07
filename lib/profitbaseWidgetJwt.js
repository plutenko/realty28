import { getProfitbaseSettings } from './profitbaseSettings'

/**
 * JWT виджета Profitbase: из .env или автоматически через SSO
 * (тот же запрос, что в cdn.profitbase.ru/smart/sw.js → siteWidgetAuth).
 *
 * В .env не пишем — только in-memory кэш на время работы Node.
 *
 * Авто-режим: задайте NEXT_PUBLIC_PROFITBASE_ACCOUNT_ID (или PROFITBASE_SSO_TENANT_ID)
 * и PROFITBASE_SITE_WIDGET_REFERER — точный referer сайта, где висит виджет (как в init виджета).
 */

const SSO_HEADROOM_MS = 120_000

/** @type {{ token: string, expiresAtMs: number }} */
let ssoCache = { token: '', expiresAtMs: 0 }

/** Сброс кэша SSO (вызывается при переключении между per-source настройками) */
export function clearSsoCache() { ssoCache = { token: '', expiresAtMs: 0 } }

function decodeJwtExpMs(jwt) {
  try {
    const parts = String(jwt).split('.')
    if (parts.length < 2) return null
    const pad = parts[1].length % 4 === 0 ? '' : '='.repeat(4 - (parts[1].length % 4))
    const json = Buffer.from(
      parts[1].replace(/-/g, '+').replace(/_/g, '/') + pad,
      'base64'
    ).toString('utf8')
    const p = JSON.parse(json)
    const exp = p.exp
    if (typeof exp === 'number') return exp * 1000
    if (typeof exp === 'string' && /^\d/.test(exp)) return Number(exp) * 1000
    return null
  } catch {
    return null
  }
}

export function profitbaseJwtLooksFresh(jwt, headroomMs = SSO_HEADROOM_MS) {
  const expMs = decodeJwtExpMs(jwt)
  if (expMs == null) return true
  return Date.now() + headroomMs < expMs
}

function manualJwtFromEnv() {
  return (
    process.env.PROFITBASE_CRM_TOKEN ||
    process.env.NEXT_PUBLIC_PROFITBASE_TOKEN ||
    ''
  ).trim()
}

function tenantId() {
  return (
    process.env.PROFITBASE_SSO_TENANT_ID ||
    process.env.NEXT_PUBLIC_PROFITBASE_ACCOUNT_ID ||
    ''
  ).trim()
}

function siteWidgetReferer() {
  return (process.env.PROFITBASE_SITE_WIDGET_REFERER || '').trim()
}

function pbDomain() {
  return (process.env.PROFITBASE_PB_DOMAIN || 'profitbase.ru').replace(/^\.+/, '')
}

async function fetchSsoSiteWidgetToken() {
  const settings = await getProfitbaseSettings()
  const accountId = settings.accountId || tenantId()
  const referer = settings.siteWidgetReferer || siteWidgetReferer()
  if (!accountId || !referer) {
    return {
      ok: false,
      error:
        'Для авто-JWT задайте NEXT_PUBLIC_PROFITBASE_ACCOUNT_ID и PROFITBASE_SITE_WIDGET_REFERER',
    }
  }

  const clientId = (process.env.PROFITBASE_SSO_CLIENT_ID || 'site_widget').trim()
  const clientSecret = (
    process.env.PROFITBASE_SSO_CLIENT_SECRET || 'site_widget'
  ).trim()
  const grantType = (process.env.PROFITBASE_SSO_GRANT_TYPE || 'site_widget').trim()

  const url = `https://sso.${settings.pbDomain || pbDomain()}/api/oauth2/token`
  const body = {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: grantType,
    scope: 'SITE_WIDGET',
    referer,
  }
  const agency = (process.env.PROFITBASE_SITE_WIDGET_AGENCY_REFERER || '').trim()
  if (agency) body.agencyReferer = agency

  const refNorm = referer.replace(/\/$/, '')
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Tenant-Id': String(accountId),
        Origin: refNorm,
        Referer: `${refNorm}/`,
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    return { ok: false, error: e?.message || 'SSO fetch failed' }
  }

  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: text.slice(0, 400), status: res.status }
  }

  if (!res.ok || !json.access_token) {
    return {
      ok: false,
      error: json?.detail || json?.message || json?.error || text.slice(0, 400),
      status: res.status,
    }
  }

  const expiresIn = Number(json.expires_in) || 3600
  ssoCache = {
    token: json.access_token,
    expiresAtMs: Date.now() + expiresIn * 1000 - SSO_HEADROOM_MS,
  }

  return { ok: true, access_token: json.access_token }
}

/**
 * @returns {Promise<string>} JWT или пустая строка
 */
export async function getProfitbaseWidgetJwt() {
  const manual = manualJwtFromEnv()
  if (manual && profitbaseJwtLooksFresh(manual)) {
    return manual
  }

  const settings = await getProfitbaseSettings()
  const hasAuto = (settings.accountId || tenantId()) && (settings.siteWidgetReferer || siteWidgetReferer())
  if (hasAuto) {
    if (ssoCache.token && Date.now() < ssoCache.expiresAtMs) {
      return ssoCache.token
    }
    const sso = await fetchSsoSiteWidgetToken()
    if (sso.ok && sso.access_token) {
      return sso.access_token
    }
  }

  return manual
}
