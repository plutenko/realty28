import crypto from 'crypto'

/**
 * Вычисляет отпечаток устройства на основе серверных данных запроса
 * и клиентских данных (разрешение экрана, timezone).
 * Одинаковые браузеры на одном компе → один и тот же хэш.
 */
export function computeDeviceHash({ userAgent = '', clientHints = {} }) {
  const os = parseOS(userAgent)
  const platform = String(clientHints.platform || '').toLowerCase()
  const screen = String(clientHints.screen || '')
  const timezone = String(clientHints.timezone || '')

  const browserId = String(clientHints.browserId || '')
  const raw = `${os}|${platform}|${screen}|${timezone}|${browserId}`
  return crypto.createHash('sha256').update(raw).digest('hex')
}

export function deviceLabelFromRequest({ userAgent = '', clientHints = {} }) {
  const os = parseOS(userAgent)
  const browser = parseBrowser(userAgent)
  const screen = clientHints.screen ? ` · ${clientHints.screen}` : ''
  return `${os} · ${browser}${screen}`
}

function parseOS(ua) {
  if (/Windows NT 10\.0/.test(ua)) return 'Windows 10/11'
  if (/Windows NT 6\.[23]/.test(ua)) return 'Windows 8'
  if (/Windows NT 6\.1/.test(ua)) return 'Windows 7'
  if (/Windows/.test(ua)) return 'Windows'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Mac OS X/.test(ua)) return 'macOS'
  if (/Linux/.test(ua)) return 'Linux'
  return 'ОС'
}

function parseBrowser(ua) {
  if (/YaBrowser/.test(ua)) return 'Яндекс'
  if (/Edg\//.test(ua)) return 'Edge'
  if (/OPR\/|Opera/.test(ua)) return 'Opera'
  if (/Chrome\//.test(ua)) return 'Chrome'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'Браузер'
}
