/**
 * Profitbase JSON API v4
 * - Виджет (JWT из sso / oauth2): GET /property?houseId=… с Authorization: Bearer — как GET /house в Network
 * - Серверный ключ: GET /property?access_token=… после POST /authentication
 */

function siteWidgetOrigin() {
  return (
    process.env.PROFITBASE_SITE_WIDGET_ORIGIN || 'https://smart-catalog.profitbase.ru'
  ).replace(/\/$/, '')
}

/** Заголовки как у Angular-виджета на smart-catalog → pb20366 */
function siteWidgetJsonHeaders(jwt) {
  const o = siteWidgetOrigin()
  return {
    Accept: 'application/json, text/plain, */*',
    Authorization: `Bearer ${jwt}`,
    Origin: o,
    Referer: `${o}/`,
  }
}

function jsonApiBaseUrl() {
  const host = (
    process.env.PROFITBASE_API_HOST || 'https://pb20366.profitbase.ru'
  ).replace(/\/$/, '')
  return `${host}/api/v4/json`
}

/** Официальный ключ приложения (app-…) */
function apiAppKey() {
  return (process.env.PROFITBASE_API_APP_KEY || '').trim()
}

/** Ключ виджета с сайта застройщика (query pbApiKey); совпадает с fallback в admin/sources (smallGrid) */
function widgetPbApiKey() {
  return (
    process.env.PROFITBASE_WIDGET_PB_API_KEY ||
    process.env.NEXT_PUBLIC_PROFITBASE_PB_API_KEY ||
    'eea9e12b6f1c86bd226ebf30761e3cd9'
  ).trim()
}

/** Уникальные непустые ключи для POST /authentication (порядок: кабинет → виджет) */
export function profitbaseAuthKeysInOrder() {
  const keys = [apiAppKey(), widgetPbApiKey()].filter(Boolean)
  return [...new Set(keys)]
}

export function profitbaseV4Configured() {
  return profitbaseAuthKeysInOrder().length > 0
}

/** @type {Map<string, { token: string, expiresAt: number }>} */
const tokenCacheByKey = new Map()

async function authenticateWithPbKey(base, pbApiKey) {
  const now = Date.now()
  const cached = tokenCacheByKey.get(pbApiKey)
  if (cached && now < cached.expiresAt - 60_000) {
    return { ok: true, accessToken: cached.token, base }
  }

  let res
  try {
    res = await fetch(`${base}/authentication`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        type: 'api-app',
        credentials: { pb_api_key: pbApiKey },
      }),
    })
  } catch (e) {
    return {
      ok: false,
      error: e?.message || 'authentication fetch failed',
      status: 502,
    }
  }

  const text = await res.text()
  if (!res.ok) {
    return {
      ok: false,
      error: text.slice(0, 500),
      status: res.status,
    }
  }

  let json
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'authentication: не JSON', status: 502 }
  }

  const accessToken = json?.access_token
  const remaining = Number(json?.remaining_time) || 3600
  if (!accessToken) {
    return { ok: false, error: 'Нет access_token в ответе authentication', status: 502 }
  }

  tokenCacheByKey.set(pbApiKey, {
    token: accessToken,
    expiresAt: now + remaining * 1000,
  })

  return { ok: true, accessToken, base }
}

export async function getProfitbaseV4AccessToken() {
  const base = jsonApiBaseUrl()
  const keys = profitbaseAuthKeysInOrder()
  if (!keys.length) {
    return { ok: false, error: 'Нет ключа для v4 (app или pbApiKey виджета)', status: 500 }
  }

  let lastErr = { error: '', status: 500 }
  for (const pbApiKey of keys) {
    const r = await authenticateWithPbKey(base, pbApiKey)
    if (r.ok) return r
    lastErr = { error: r.error, status: r.status }
  }

  return { ok: false, error: lastErr.error, status: lastErr.status }
}

export async function fetchProfitbaseV4PropertyList(houseId) {
  const auth = await getProfitbaseV4AccessToken()
  if (!auth.ok) return auth

  const u = new URL(`${auth.base}/property`)
  u.searchParams.set('access_token', auth.accessToken)
  u.searchParams.set('houseId', String(houseId))

  let r
  try {
    r = await fetch(u.toString(), { headers: { Accept: 'application/json' } })
  } catch (e) {
    return {
      ok: false,
      error: e?.message || 'property list fetch failed',
      status: 502,
    }
  }

  const text = await r.text()
  if (!r.ok) {
    return { ok: false, error: text.slice(0, 800), status: r.status }
  }

  return { ok: true, text, status: r.status }
}

/**
 * JWT виджета (SITE_WIDGET): список квартир через Bearer — рабочий путь с megatek / smart-catalog.
 */
export async function fetchProfitbasePropertyListWithSiteWidgetBearer(houseId, jwt) {
  const token = String(jwt || '').trim()
  if (!token) {
    return { ok: false, error: 'Пустой JWT', status: 400 }
  }

  const base = jsonApiBaseUrl()
  const u = new URL(`${base}/property`)
  u.searchParams.set('houseId', String(houseId))

  let r
  try {
    r = await fetch(u.toString(), { headers: siteWidgetJsonHeaders(token) })
  } catch (e) {
    return {
      ok: false,
      error: e?.message || 'property list fetch failed',
      status: 502,
    }
  }

  const text = await r.text()
  if (!r.ok) {
    return { ok: false, error: text.slice(0, 800), status: r.status }
  }

  return { ok: true, text, status: r.status }
}

export async function fetchProfitbaseBoardWithSiteWidgetBearer(houseId, jwt, filterValue = undefined) {
  const token = String(jwt || '').trim()
  if (!token) {
    return { ok: false, error: 'Пустой JWT', status: 400 }
  }

  const base = jsonApiBaseUrl()
  const u = new URL(`${base}/board`)
  u.searchParams.set('houseId', String(houseId))
  const useFilter =
    filterValue !== undefined &&
    String(filterValue).trim() !== '' &&
    String(filterValue).trim().toLowerCase() !== '__none__'
  if (useFilter) u.searchParams.set('filter', String(filterValue))

  let r
  try {
    r = await fetch(u.toString(), { headers: siteWidgetJsonHeaders(token) })
  } catch (e) {
    return {
      ok: false,
      error: e?.message || 'board fetch failed',
      status: 502,
    }
  }

  const text = await r.text()
  if (!r.ok) {
    return { ok: false, error: text.slice(0, 800), status: r.status }
  }

  return { ok: true, text, status: r.status }
}

/**
 * Запасной вариант: JWT в query как access_token (у многих аккаунтов не срабатывает).
 */
export async function fetchProfitbasePropertyListWithJwtAccessToken(houseId, jwt) {
  const token = String(jwt || '').trim()
  if (!token) {
    return { ok: false, error: 'Пустой JWT', status: 400 }
  }

  const base = jsonApiBaseUrl()
  const u = new URL(`${base}/property`)
  u.searchParams.set('access_token', token)
  u.searchParams.set('houseId', String(houseId))

  let r
  try {
    r = await fetch(u.toString(), { headers: { Accept: 'application/json' } })
  } catch (e) {
    return {
      ok: false,
      error: e?.message || 'property list fetch failed',
      status: 502,
    }
  }

  const text = await r.text()
  if (!r.ok) {
    return { ok: false, error: text.slice(0, 800), status: r.status }
  }

  return { ok: true, text, status: r.status }
}

export async function fetchProfitbaseV4PropertyById(propertyId) {
  const auth = await getProfitbaseV4AccessToken()
  if (!auth.ok) return auth

  const u = new URL(`${auth.base}/property`)
  u.searchParams.set('access_token', auth.accessToken)
  u.searchParams.set('id', String(propertyId))

  let r
  try {
    r = await fetch(u.toString(), { headers: { Accept: 'application/json' } })
  } catch (e) {
    return {
      ok: false,
      error: e?.message || 'property fetch failed',
      status: 502,
    }
  }

  const text = await r.text()
  return { ok: r.ok, text, status: r.status }
}

export async function fetchProfitbasePropertyByIdWithSiteWidgetBearer(propertyId, jwt) {
  const token = String(jwt || '').trim()
  if (!token) {
    return { ok: false, error: 'Пустой JWT', status: 400 }
  }

  const base = jsonApiBaseUrl()
  const u = new URL(`${base}/property`)
  u.searchParams.set('id', String(propertyId))

  let r
  try {
    r = await fetch(u.toString(), { headers: siteWidgetJsonHeaders(token) })
  } catch (e) {
    return {
      ok: false,
      error: e?.message || 'property fetch failed',
      status: 502,
    }
  }

  const text = await r.text()
  return { ok: r.ok, text, status: r.status }
}

export async function fetchProfitbasePropertyByIdWithJwtAccessToken(propertyId, jwt) {
  const token = String(jwt || '').trim()
  if (!token) {
    return { ok: false, error: 'Пустой JWT', status: 400 }
  }

  const base = jsonApiBaseUrl()
  const u = new URL(`${base}/property`)
  u.searchParams.set('access_token', token)
  u.searchParams.set('id', String(propertyId))

  let r
  try {
    r = await fetch(u.toString(), { headers: { Accept: 'application/json' } })
  } catch (e) {
    return {
      ok: false,
      error: e?.message || 'property fetch failed',
      status: 502,
    }
  }

  const text = await r.text()
  return { ok: r.ok, text, status: r.status }
}
