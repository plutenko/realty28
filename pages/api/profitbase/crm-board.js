import { fetchProfitbaseCrmBoardBody } from '../../../lib/profitbaseCrmFetch'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const houseId = String(req.query.houseId || req.query.house_id || '').trim()
  if (!houseId) {
    return res.status(400).json({ error: 'houseId required' })
  }

  const filterValue = String(req.query.filter || '').trim()
  const r = await fetchProfitbaseCrmBoardBody(houseId, filterValue || undefined)
  if (r.ok && r.text) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return res.status(200).send(r.text)
  }

  return res.status(502).json({
    error: 'Board недоступен',
    detail: String(r.error || '').slice(0, 800),
  })
}

