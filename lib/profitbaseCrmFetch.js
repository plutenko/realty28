/**
 * Серверная выборка списка / карточки квартиры — та же цепочка, что /api/profitbase/crm-*. (авто-JWT + v4)
 */
import {
  fetchProfitbaseBoardWithSiteWidgetBearer,
  fetchProfitbaseBoardWithV4,
  fetchProfitbasePropertyByIdWithJwtAccessToken,
  fetchProfitbasePropertyByIdWithSiteWidgetBearer,
  fetchProfitbasePropertyListWithJwtAccessToken,
  fetchProfitbasePropertyListWithSiteWidgetBearer,
  fetchProfitbaseV4PropertyById,
  fetchProfitbaseV4PropertyList,
  profitbaseV4Configured,
} from './profitbaseV4'
import { getProfitbaseWidgetJwt } from './profitbaseWidgetJwt'

export async function fetchProfitbaseCrmPropertyListBody(houseId) {
  const id = String(houseId || '').trim()
  if (!id) {
    return { ok: false, error: 'houseId required' }
  }

  const jwt = await getProfitbaseWidgetJwt()

  if (jwt) {
    const sw = await fetchProfitbasePropertyListWithSiteWidgetBearer(id, jwt)
    if (sw.ok) return { ok: true, text: sw.text }
  }

  if (profitbaseV4Configured()) {
    const v4 = await fetchProfitbaseV4PropertyList(id)
    if (v4.ok) return { ok: true, text: v4.text }
  }

  if (jwt) {
    const asAccess = await fetchProfitbasePropertyListWithJwtAccessToken(id, jwt)
    if (asAccess.ok) return { ok: true, text: asAccess.text }
  }

  if (!jwt) {
    return {
      ok: false,
      error:
        'Нет JWT: NEXT_PUBLIC_PROFITBASE_ACCOUNT_ID + PROFITBASE_SITE_WIDGET_REFERER или PROFITBASE_CRM_TOKEN',
    }
  }

  return { ok: false, error: 'Список квартир недоступен (JWT / v4)' }
}

export async function fetchProfitbaseCrmBoardBody(houseId, filterValue = undefined) {
  const id = String(houseId || '').trim()
  if (!id) return { ok: false, error: 'houseId required' }

  const { jsonApiBaseUrlFromSettings } = await import('./profitbaseV4.js')
  const { getProfitbaseSettings } = await import('./profitbaseSettings.js')
  const settings = await getProfitbaseSettings()
  const baseUrl = await jsonApiBaseUrlFromSettings()
  const debugInfo = `[API: ${baseUrl}, account: ${settings.accountId || '?'}, referer: ${settings.siteWidgetReferer || '?'}]`

  const errors = []

  const jwt = await getProfitbaseWidgetJwt()
  if (jwt) {
    const sw = await fetchProfitbaseBoardWithSiteWidgetBearer(id, jwt, filterValue)
    if (sw.ok) return { ok: true, text: sw.text }
    errors.push(`Bearer: ${sw.error || sw.status || 'failed'}`)
  } else {
    errors.push('JWT не получен')
  }

  // Fallback: v4 API key auth
  if (profitbaseV4Configured()) {
    const v4 = await fetchProfitbaseBoardWithV4(id, filterValue)
    if (v4.ok) return { ok: true, text: v4.text }
    errors.push(`v4: ${v4.error || 'failed'}`)
  }

  // Fallback: JWT as access_token query param
  if (jwt) {
    try {
      const u = new URL(`${baseUrl}/board`)
      u.searchParams.set('access_token', jwt)
      u.searchParams.set('houseId', id)
      const r = await fetch(u.toString(), { headers: { Accept: 'application/json' } })
      if (r.ok) {
        const text = await r.text()
        return { ok: true, text }
      }
      errors.push(`access_token: HTTP ${r.status}`)
    } catch (e) {
      errors.push(`access_token: ${e.message}`)
    }
  }

  return {
    ok: false,
    error: `board недоступен ${debugInfo}. Попытки: ${errors.join('; ')}`,
  }
}

export async function fetchProfitbaseCrmPropertyBody(propertyId) {
  const id = String(propertyId || '').trim()
  if (!id) {
    return { ok: false, error: 'propertyId required' }
  }

  const jwt = await getProfitbaseWidgetJwt()

  if (jwt) {
    const sw = await fetchProfitbasePropertyByIdWithSiteWidgetBearer(id, jwt)
    if (sw.ok) return { ok: true, text: sw.text }
  }

  if (profitbaseV4Configured()) {
    const v4 = await fetchProfitbaseV4PropertyById(id)
    if (v4.ok) return { ok: true, text: v4.text }
  }

  if (jwt) {
    const j = await fetchProfitbasePropertyByIdWithJwtAccessToken(id, jwt)
    if (j.ok) return { ok: true, text: j.text }
  }

  if (!jwt) {
    return {
      ok: false,
      error:
        'Нет JWT: NEXT_PUBLIC_PROFITBASE_ACCOUNT_ID + PROFITBASE_SITE_WIDGET_REFERER или PROFITBASE_CRM_TOKEN',
    }
  }

  return { ok: false, error: 'Квартира недоступна (JWT / v4)' }
}
