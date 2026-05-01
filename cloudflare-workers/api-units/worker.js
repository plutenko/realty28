/**
 * CF Worker — edge cache для /api/units (и других тяжёлых публичных API).
 *
 * Зачем: основной CF proxy на domovoy28.ru обрывал стриминг /api/units на ~17 КБ
 * (cf-cache-status: DYNAMIC + RST через 100с — буферизация большого gzipped chunked).
 * Worker fetch'ит origin сам, кеширует ответ через CF Cache API и отдаёт клиенту
 * с CORS-заголовками. Edge-кеш живёт 5 мин (как s-maxage origin'а).
 *
 * Endpoints:
 *   GET  /units                    — отдаёт кешированный ответ или фетчит origin
 *   GET  /complexes                — то же для /api/complexes
 *   GET  /buildings-summary        — то же для /api/buildings-summary
 *   POST /purge?secret=...         — удаляет все три ключа из cache + дёргает origin
 *
 * Origin'у инвалидация делается отдельно (admin/units.js → /api/units?invalidate=1).
 * Этот Worker обнуляет ТОЛЬКО edge-кеш Worker'а.
 */

const ORIGIN = 'https://domovoy28.ru'
const ALLOWED_ORIGIN = 'https://domovoy28.ru'
const CACHE_TTL = 300 // 5 минут

const ROUTES = {
  '/units': '/api/units',
  '/complexes': '/api/complexes',
  '/buildings-summary': '/api/buildings-summary',
}

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
    'Access-Control-Expose-Headers': 'ETag, X-Worker-Cache, X-Cache, Content-Encoding',
    'Vary': 'Origin, Accept-Encoding',
    ...extra,
  }
}

function withCors(response) {
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v)
  return new Response(response.body, { status: response.status, headers })
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    if (request.method === 'POST' && url.pathname === '/purge') {
      const secret = url.searchParams.get('secret')
      if (!env.PURGE_SECRET || secret !== env.PURGE_SECRET) {
        return new Response('forbidden', { status: 403, headers: corsHeaders() })
      }
      const cache = caches.default
      const purgedKeys = []
      for (const path of Object.keys(ROUTES)) {
        const key = new Request(`${url.origin}${path}`, { method: 'GET' })
        const ok = await cache.delete(key)
        if (ok) purgedKeys.push(path)
      }
      ctx.waitUntil(
        fetch(`${ORIGIN}/api/units?invalidate=1`).catch(() => {})
      )
      return new Response(JSON.stringify({ ok: true, purged: purgedKeys }), {
        status: 200,
        headers: corsHeaders({ 'Content-Type': 'application/json' }),
      })
    }

    if (request.method !== 'GET') {
      return new Response('method not allowed', { status: 405, headers: corsHeaders() })
    }

    const upstreamPath = ROUTES[url.pathname]
    if (!upstreamPath) {
      return new Response('not found', { status: 404, headers: corsHeaders() })
    }

    const cache = caches.default
    // Канонический ключ — без query-параметров (?fresh=1 обходит кеш ниже).
    const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: 'GET' })

    const fresh = url.searchParams.get('fresh') === '1'
    if (!fresh) {
      const cached = await cache.match(cacheKey)
      if (cached) {
        const headers = new Headers(cached.headers)
        headers.set('X-Worker-Cache', 'HIT')
        for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v)
        // Поддерживаем 304: если клиент прислал If-None-Match и совпало с ETag.
        const inm = request.headers.get('if-none-match')
        const etag = headers.get('etag')
        if (inm && etag && inm === etag) {
          return new Response(null, { status: 304, headers })
        }
        return new Response(cached.body, { status: cached.status, headers })
      }
    }

    let originResp
    try {
      originResp = await fetch(`${ORIGIN}${upstreamPath}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'User-Agent': 'cf-worker-api-units/1.0',
        },
        cf: { cacheTtl: 0, cacheEverything: false },
      })
    } catch (e) {
      return new Response(`origin error: ${e?.message || e}`, {
        status: 502, headers: corsHeaders(),
      })
    }

    if (!originResp.ok) {
      return new Response(`upstream ${originResp.status}`, {
        status: 502, headers: corsHeaders(),
      })
    }

    // Готовим response для отдачи клиенту: проставляем cache-control + наши заголовки.
    const respHeaders = new Headers(originResp.headers)
    respHeaders.set('Cache-Control', `public, max-age=${CACHE_TTL}`)
    respHeaders.set('X-Worker-Cache', 'MISS')
    // Origin'овский streaming-ответ не имеет ETag (Next.js не считает его на res.write).
    // Без ETag F5-revalidate тащит 117 КБ снова — синтезируем weak ETag, привязанный
    // к конкретной cache-entry. Сохранится в cache.put и будет совпадать на всех HIT'ах
    // до следующей инвалидации.
    if (!respHeaders.has('etag')) {
      const synthEtag = `W/"u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}"`
      respHeaders.set('ETag', synthEtag)
    }
    for (const [k, v] of Object.entries(corsHeaders())) respHeaders.set(k, v)

    // Клонируем тело: одно идёт в cache.put, второе — клиенту.
    const [bodyForCache, bodyForClient] = originResp.body.tee()

    const cacheResp = new Response(bodyForCache, {
      status: originResp.status,
      headers: respHeaders,
    })
    ctx.waitUntil(cache.put(cacheKey, cacheResp))

    return new Response(bodyForClient, {
      status: originResp.status,
      headers: respHeaders,
    })
  },
}
