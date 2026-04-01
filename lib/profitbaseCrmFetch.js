/**
 * Серверная выборка списка / карточки квартиры — та же цепочка, что /api/profitbase/crm-*. (авто-JWT + v4)
 */
import {
  fetchProfitbaseBoardWithSiteWidgetBearer,
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

  const jwt = await getProfitbaseWidgetJwt()
  if (jwt) {
    const sw = await fetchProfitbaseBoardWithSiteWidgetBearer(id, jwt, filterValue)
    if (sw.ok) return { ok: true, text: sw.text }
  }

  return { ok: false, error: 'board недоступен (JWT)' }
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
