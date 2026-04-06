import https from 'https'
import http from 'http'

function fetchPage(pageUrl, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = pageUrl.startsWith('https') ? https : http
    const req = lib.get(
      pageUrl,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 12000 },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
          let loc = res.headers.location
          if (loc.startsWith('/')) {
            const u = new URL(pageUrl)
            loc = u.origin + loc
          } else if (!loc.startsWith('http')) {
            loc = new URL(loc, pageUrl).href
          }
          resolve(fetchPage(loc, maxRedirects - 1))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

const ACCOUNT_PATTERNS = [
  /["']?accountId["']?\s*[:=]\s*["']?(\d{4,6})["']?/gi,
  /["']?account_id["']?\s*[:=]\s*["']?(\d{4,6})["']?/gi,
  /accountId[=:](\d{4,6})/gi,
  /X-Tenant-Id["':,\s]+["']?(\d{4,6})/gi,
  /tenantId["':=\s]+["']?(\d{4,6})/gi,
  /data-account-id=["']?(\d{4,6})/gi,
  /pb(\d{4,6})\.profitbase/gi,
]

const API_KEY_PATTERNS = [
  /["']?pbApiKey["']?\s*[:=]\s*["']([a-f0-9]{20,})["']/gi,
  /["']?pb_api_key["']?\s*[:=]\s*["']([a-f0-9]{20,})["']/gi,
  /pbApiKey[=:]([a-f0-9]{20,})/gi,
]

function extractFromText(text) {
  const accounts = new Map()
  const apiKeys = new Set()

  for (const re of ACCOUNT_PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      const id = m[1]
      accounts.set(id, (accounts.get(id) || 0) + 1)
    }
  }

  for (const re of API_KEY_PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      apiKeys.add(m[1])
    }
  }

  // Pick the most frequently found accountId
  let bestAccount = null
  let bestCount = 0
  for (const [id, count] of accounts) {
    if (count > bestCount) { bestAccount = id; bestCount = count }
  }

  return {
    account_id: bestAccount,
    pb_api_key: apiKeys.size ? [...apiKeys][0] : null,
  }
}

/** Extract script src URLs from HTML */
function extractScriptUrls(html, baseUrl) {
  const urls = []
  const re = /<script[^>]+src=["']([^"']+)["']/gi
  let m
  while ((m = re.exec(html)) !== null) {
    let src = m[1]
    if (src.startsWith('//')) src = 'https:' + src
    else if (src.startsWith('/')) {
      try { src = new URL(src, baseUrl).href } catch { continue }
    } else if (!src.startsWith('http')) {
      try { src = new URL(src, baseUrl).href } catch { continue }
    }
    urls.push(src)
  }
  return urls
}

/** Try SSO token request with candidate accountId + referer to validate */
async function validateAccountWithSso(accountId, referer) {
  const url = `https://sso.profitbase.ru/api/oauth2/token`
  const body = JSON.stringify({
    client_id: 'site_widget',
    client_secret: 'site_widget',
    grant_type: 'site_widget',
    scope: 'SITE_WIDGET',
    referer,
  })
  const refNorm = referer.replace(/\/$/, '')
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Tenant-Id': String(accountId),
        Origin: refNorm,
        Referer: `${refNorm}/`,
      },
      body,
      signal: AbortSignal.timeout(8000),
    })
    const json = await r.json().catch(() => null)
    return r.ok && json?.access_token
  } catch {
    return false
  }
}

export default async function handler(req, res) {
  const rawUrl = String(req.query.url || '').trim()
  if (!rawUrl) return res.status(400).json({ error: 'url is required' })

  const result = { houseId: null, referer: null, account_id: null, pb_api_key: null, debug: [] }

  // 1. Extract houseId & referer from URL
  try {
    const u = new URL(rawUrl)
    result.referer = u.origin

    const hash = u.hash || ''
    const houseMatch = hash.match(/\/house\/(\d+)/) || u.pathname.match(/\/house\/(\d+)/)
    if (houseMatch) result.houseId = houseMatch[1]

    const qHouse = u.searchParams.get('house_id') || u.searchParams.get('houseId')
    if (qHouse && !result.houseId) result.houseId = qHouse
  } catch {
    if (/^\d+$/.test(rawUrl)) result.houseId = rawUrl
  }

  // 2. Fetch the page HTML
  let html = ''
  try {
    html = await fetchPage(rawUrl)
    result.debug.push(`HTML: ${html.length} bytes`)
  } catch (e) {
    result.debug.push(`HTML fetch failed: ${e.message}`)
  }

  // 3. Extract from HTML
  if (html) {
    const fromHtml = extractFromText(html)
    if (fromHtml.account_id) result.account_id = fromHtml.account_id
    if (fromHtml.pb_api_key) result.pb_api_key = fromHtml.pb_api_key
  }

  // 4. Fetch and scan JS bundles (up to 5 biggest)
  if (html && !result.account_id) {
    const scriptUrls = extractScriptUrls(html, result.referer || rawUrl)
    result.debug.push(`Scripts found: ${scriptUrls.length}`)

    // Prioritize profitbase-related scripts
    const sorted = scriptUrls.sort((a, b) => {
      const aPb = /profitbase|catalog|widget/i.test(a) ? 0 : 1
      const bPb = /profitbase|catalog|widget/i.test(b) ? 0 : 1
      return aPb - bPb
    })

    for (const scriptUrl of sorted.slice(0, 8)) {
      try {
        const js = await fetchPage(scriptUrl)
        result.debug.push(`JS ${scriptUrl.slice(-40)}: ${js.length} bytes`)
        const fromJs = extractFromText(js)
        if (fromJs.account_id && !result.account_id) {
          result.account_id = fromJs.account_id
          result.debug.push(`Found accountId=${fromJs.account_id} in JS`)
        }
        if (fromJs.pb_api_key && !result.pb_api_key) {
          result.pb_api_key = fromJs.pb_api_key
        }
        if (result.account_id) break
      } catch { /* skip */ }
    }
  }

  // 5. If we found a candidate accountId + referer, validate via SSO
  if (result.account_id && result.referer) {
    const valid = await validateAccountWithSso(result.account_id, result.referer)
    if (valid) {
      result.debug.push(`SSO validated: account ${result.account_id} + referer ${result.referer}`)
    } else {
      result.debug.push(`SSO validation failed for account ${result.account_id} + referer ${result.referer}`)
      // Don't clear — still might be correct, SSO could just require different referer
    }
  }

  return res.status(200).json(result)
}
