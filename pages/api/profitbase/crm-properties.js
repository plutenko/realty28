import { fetchProfitbaseCrmPropertyListBody } from '../../../lib/profitbaseCrmFetch'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const houseId = String(req.query.houseId || req.query.house_id || '').trim()
  if (!houseId) {
    return res.status(400).json({ error: 'houseId required' })
  }

  const r = await fetchProfitbaseCrmPropertyListBody(houseId)
  if (r.ok && r.text) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return res.status(200).send(r.text)
  }

  const msg = String(r.error || 'Upstream error')
  if (msg.includes('Нет JWT')) {
    return res.status(500).json({
      error: 'Нет доступа к Profitbase',
      detail:
        'Задайте NEXT_PUBLIC_PROFITBASE_ACCOUNT_ID и PROFITBASE_SITE_WIDGET_REFERER (авто JWT через SSO), либо PROFITBASE_CRM_TOKEN, и при необходимости ключи виджета.',
    })
  }

  return res.status(502).json({
    error:
      'Список квартир недоступен: Bearer JWT, ключ authentication и JWT в query не вернули данные.',
    hint:
      'Проверьте PROFITBASE_SITE_WIDGET_REFERER (домен сайта со виджетом, как в коде Tilda) и account id. Либо обновите PROFITBASE_CRM_TOKEN.',
    detail: msg.slice(0, 800),
  })
}
