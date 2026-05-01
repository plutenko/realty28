/**
 * CF Worker — входящий прокси для Telegram webhook'ов на @sobr_reports_bot.
 * Telegram → этот Worker → https://domovoy28.ru/api/reports/telegram-webhook.
 *
 * Зачем: Timeweb-контейнер недоступен напрямую с IP-диапазонов api.telegram.org
 * (РКН-фильтрация на входящих), из-за чего Telegram копит pending_update_count
 * и со временем дропает обновления. CF Worker сидит в инфре Cloudflare,
 * Telegram ходит до него стабильно, а CF→Timeweb (домен domovoy28.ru, DNS-only)
 * проходит без проблем.
 *
 * Принцип:
 * — принимаем только POST на /api/reports/telegram-webhook;
 * — пробрасываем тело и заголовки (включая X-Telegram-Bot-Api-Secret-Token);
 * — отдаём Telegram'у HTTP-статус origin, чтобы тот корректно подтверждал/ретраил;
 * — на сетевые ошибки отвечаем 502 (Telegram сам ретраит).
 */
const TARGET = 'https://domovoy28.ru/api/reports/telegram-webhook'

const STRIP_HEADERS = new Set([
  'host',
  'cf-connecting-ip',
  'cf-ray',
  'cf-ipcountry',
  'cf-visitor',
  'cf-worker',
  'cf-ew-via',
  'cdn-loop',
  'x-forwarded-host',
  'x-forwarded-proto',
])

export default {
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname !== '/api/reports/telegram-webhook') {
      return new Response('not found', { status: 404 })
    }
    if (request.method !== 'POST') {
      return new Response('method not allowed', { status: 405 })
    }

    const headers = new Headers()
    for (const [k, v] of request.headers) {
      if (!STRIP_HEADERS.has(k.toLowerCase())) headers.set(k, v)
    }
    headers.set('x-tg-via', 'cf-tg-reports-inbound')

    let originResp
    try {
      originResp = await fetch(TARGET, {
        method: 'POST',
        headers,
        body: request.body,
      })
    } catch (e) {
      return new Response('proxy error: ' + (e?.message || e), { status: 502 })
    }

    const respHeaders = new Headers(originResp.headers)
    respHeaders.delete('set-cookie')
    return new Response(originResp.body, {
      status: originResp.status,
      headers: respHeaders,
    })
  },
}
