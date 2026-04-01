import { fetchProfitbaseCrmPropertyBody } from '../../../lib/profitbaseCrmFetch'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const propertyId = String(req.query.propertyId || req.query.id || '').trim()
  if (!propertyId) {
    return res.status(400).json({ error: 'propertyId required' })
  }

  const r = await fetchProfitbaseCrmPropertyBody(propertyId)
  if (r.ok && r.text) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return res.status(200).send(r.text)
  }

  const msg = String(r.error || 'Upstream error')
  if (msg.includes('Нет JWT')) {
    return res.status(500).json({
      error: 'Нет токена',
      detail:
        'Задайте NEXT_PUBLIC_PROFITBASE_ACCOUNT_ID и PROFITBASE_SITE_WIDGET_REFERER или PROFITBASE_CRM_TOKEN.',
    })
  }

  return res.status(502).json({
    error:
      'Квартира недоступна по JSON API v4: Bearer JWT, ключ authentication и JWT в query не вернули данные.',
    hint:
      'Проверьте PROFITBASE_SITE_WIDGET_REFERER и account id. Либо обновите PROFITBASE_CRM_TOKEN.',
    detail: msg.slice(0, 800),
  })
}
