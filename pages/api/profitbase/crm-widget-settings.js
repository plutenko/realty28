/**
 * Прокси GET /crm/api/crm-widget-settings — проверка JWT.
 */
import { getProfitbaseWidgetJwt } from '../../../lib/profitbaseWidgetJwt'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const jwt = await getProfitbaseWidgetJwt()
  if (!jwt) {
    return res.status(500).json({
      error: 'Нет JWT',
      detail:
        'Задайте NEXT_PUBLIC_PROFITBASE_ACCOUNT_ID и PROFITBASE_SITE_WIDGET_REFERER (авто SSO) или PROFITBASE_CRM_TOKEN.',
    })
  }

  const host = (
    process.env.PROFITBASE_CRM_HOST ||
    process.env.PROFITBASE_API_HOST ||
    'https://pb20366.profitbase.ru'
  ).replace(/\/$/, '')
  const siteOrigin = (
    process.env.PROFITBASE_SITE_WIDGET_ORIGIN || 'https://smart-catalog.profitbase.ru'
  ).replace(/\/$/, '')
  const url = `${host}/crm/api/crm-widget-settings`

  try {
    const r = await fetch(url, {
      headers: {
        Accept: 'application/ld+json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
        Origin: siteOrigin,
        Referer: `${siteOrigin}/`,
      },
    })
    const text = await r.text()
    const ct = r.headers.get('content-type')
    if (ct) res.setHeader('Content-Type', ct)
    return res.status(r.status).send(text)
  } catch (e) {
    return res.status(502).json({ error: e?.message || 'Upstream failed' })
  }
}
