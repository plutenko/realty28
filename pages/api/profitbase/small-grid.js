/** Прокси smallGrid: иначе с админки ловится CORS на smart-catalog.profitbase.ru */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const houseId = String(req.query.houseId || '').trim()
  if (!houseId) {
    return res.status(400).json({ error: 'houseId required' })
  }

  const accountId = String(req.query.accountId || '20366')
  const pbApiKey = String(req.query.pbApiKey || '')
  const filterRaw = req.query.filter
  const useFilter =
    filterRaw !== undefined &&
    String(filterRaw).trim() !== '' &&
    String(filterRaw).trim().toLowerCase() !== '__none__'

  const u = new URL(
    `https://smart-catalog.profitbase.ru/eco/catalog/house/${encodeURIComponent(houseId)}/smallGrid`
  )
  u.searchParams.set('accountId', accountId)
  if (pbApiKey) u.searchParams.set('pbApiKey', pbApiKey)
  if (useFilter) {
    u.searchParams.set('filter', String(filterRaw))
  } else if (filterRaw === undefined) {
    u.searchParams.set('filter', 'property.status:AVAILABLE')
  }

  try {
    const r = await fetch(u.toString(), {
      headers: {
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
    })
    const text = await r.text()
    const ct = r.headers.get('content-type') || ''
    res.setHeader(
      'Content-Type',
      ct.includes('json') ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8'
    )
    return res.status(r.status).send(text)
  } catch (e) {
    return res.status(502).json({ error: e?.message || 'Upstream fetch failed' })
  }
}
