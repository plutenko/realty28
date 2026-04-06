import https from 'https'
import http from 'http'

function fetchPage(pageUrl, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const lib = pageUrl.startsWith('https') ? https : http
    const req = lib.get(pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        let loc = res.headers.location
        if (loc.startsWith('/')) {
          const u = new URL(pageUrl)
          loc = u.origin + loc
        }
        resolve(fetchPage(loc, maxRedirects - 1))
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function extractFromHtml(html) {
  const result = {}

  // accountId patterns
  const accountPatterns = [
    /["']?accountId["']?\s*[:=]\s*["']?(\d+)/i,
    /account_id["']?\s*[:=]\s*["']?(\d+)/i,
    /accountId=(\d+)/i,
    /data-account-id=["']?(\d+)/i,
  ]
  for (const re of accountPatterns) {
    const m = re.exec(html)
    if (m) { result.account_id = m[1]; break }
  }

  // pbApiKey patterns
  const apiKeyPatterns = [
    /["']?pbApiKey["']?\s*[:=]\s*["']([a-f0-9]{20,})["']/i,
    /pb_api_key["']?\s*[:=]\s*["']([a-f0-9]{20,})["']/i,
    /pbApiKey=([a-f0-9]{20,})/i,
  ]
  for (const re of apiKeyPatterns) {
    const m = re.exec(html)
    if (m) { result.pb_api_key = m[1]; break }
  }

  return result
}

export default async function handler(req, res) {
  const rawUrl = String(req.query.url || '').trim()
  if (!rawUrl) return res.status(400).json({ error: 'url is required' })

  const result = { houseId: null, referer: null, account_id: null, pb_api_key: null }

  // Extract houseId from URL
  try {
    const u = new URL(rawUrl)
    result.referer = u.origin

    // Check hash part (SPA routes like /#/catalog/house/103325/smallGrid)
    const hash = u.hash || ''
    const houseMatch = hash.match(/\/house\/(\d+)/) || u.pathname.match(/\/house\/(\d+)/)
    if (houseMatch) result.houseId = houseMatch[1]

    const qHouse = u.searchParams.get('house_id') || u.searchParams.get('houseId')
    if (qHouse && !result.houseId) result.houseId = qHouse
  } catch {
    // not a valid URL
    if (/^\d+$/.test(rawUrl)) result.houseId = rawUrl
  }

  // Try to fetch the page and extract accountId / pbApiKey
  try {
    const html = await fetchPage(rawUrl)
    const extracted = extractFromHtml(html)
    if (extracted.account_id) result.account_id = extracted.account_id
    if (extracted.pb_api_key) result.pb_api_key = extracted.pb_api_key
  } catch {
    // page fetch failed — not critical
  }

  return res.status(200).json(result)
}
