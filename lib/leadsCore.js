import crypto from 'crypto'

const KIND_PREFIXES = {
  marquiz: 'mrq',
  tilda: 'tld',
  manual: 'man',
}

export function generateSourceKey(kind) {
  const prefix = KIND_PREFIXES[kind] || 'src'
  return `${prefix}_${crypto.randomBytes(16).toString('hex')}`
}

export function normalizePhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D+/g, '')
  if (!digits) return null
  if (digits.length === 11 && digits[0] === '8') return '+7' + digits.slice(1)
  if (digits.length === 11 && digits[0] === '7') return '+' + digits
  if (digits.length === 10) return '+7' + digits
  if (digits.length >= 11) return '+' + digits
  return null
}

export function pickAnswerByKeywords(answers, keywords) {
  const arr = Array.isArray(answers) ? answers : []
  const needles = keywords.map(k => k.toLowerCase())
  for (const item of arr) {
    const q = String(item?.question || item?.q || '').toLowerCase()
    if (!q) continue
    if (needles.some(n => q.includes(n))) {
      const a = item?.answer ?? item?.a
      if (a === undefined || a === null) continue
      if (Array.isArray(a)) return a.map(String).filter(Boolean).join(', ')
      return String(a)
    }
  }
  return null
}

export function mapMarquizPayload(payload) {
  const p = payload || {}
  const answersRaw = Array.isArray(p.answers) ? p.answers : []

  const name = p.name || p.contacts?.name || null
  const phone = p.phone || p.contacts?.phone || null
  const email = p.email || p.contacts?.email || null

  const rooms = pickAnswerByKeywords(answersRaw, ['комнат', 'комната'])
  const budget = pickAnswerByKeywords(answersRaw, ['бюджет', 'стоимость', 'цена'])

  const extra = p.extra || {}
  const utm = extra.utm || {}

  // Мессенджер: Марквиз кладёт в extra.messenger ('max', 'whatsapp', 'telegram', 'viber', ...)
  // Дубль в contacts[messenger] = phone — игнорим, основной phone уже есть.
  const messenger = extra.messenger || null

  // yclid (Yandex Click ID) — Я.Директ кладёт в URL объявления как ?yclid=xxx
  // Markwiz пробрасывает через extra.yclid если в Settings → Hidden fields
  // настроен соответствующий проброс. Если не настроен — пытаемся вытащить
  // из href URL.
  const yclid = extractYclid(extra)

  return {
    name: name ? String(name).trim() : null,
    phone: phone ? String(phone).trim() : null,
    phone_normalized: normalizePhone(phone),
    email: email ? String(email).trim() : null,
    rooms: rooms || null,
    budget: budget || null,
    answers: answersRaw,
    messenger: messenger ? String(messenger).toLowerCase().trim() : null,
    yclid: yclid || null,
    utm: {
      source: utm.source || null,
      medium: utm.medium || null,
      campaign: utm.campaign || null,
      content: utm.content || null,
      term: utm.term || null,
      href: extra.href || null,
      referrer: extra.referrer || null,
    },
  }
}

function extractYclid(extra) {
  if (!extra) return null
  // Прямой путь: Markwiz hidden field "yclid"
  if (extra.yclid) return String(extra.yclid).trim() || null
  // Fallback: парсим из href URL (Я.Директ всегда добавляет ?yclid=xxx к посадочной)
  const href = extra.href
  if (typeof href !== 'string') return null
  try {
    const u = new URL(href)
    const v = u.searchParams.get('yclid')
    return v ? String(v).trim() : null
  } catch {
    // href кривой — последняя попытка regex'ом
    const m = /[?&]yclid=([^&#]+)/.exec(href)
    return m ? decodeURIComponent(m[1]) : null
  }
}

const MESSENGER_LABELS = {
  max: 'Max',
  whatsapp: 'WhatsApp',
  whats_app: 'WhatsApp',
  telegram: 'Telegram',
  tg: 'Telegram',
  viber: 'Viber',
  signal: 'Signal',
}

export function formatMessengerLabel(key) {
  if (!key) return null
  const k = String(key).toLowerCase().trim()
  return MESSENGER_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1))
}
