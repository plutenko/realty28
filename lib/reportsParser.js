/**
 * Парсинг ежедневного отчёта риелтора.
 *
 * Формат:
 *   Отчёт 17.04                      <- маркер + дата (одиночная / с годом / диапазон)
 *   Хз - 7                           <- метрика
 *   Встречи - 2
 *   ...
 */

const DAYS_MS = 24 * 60 * 60 * 1000

/**
 * Проверяет что сообщение похоже на отчёт.
 * Маркер в первой строке ИЛИ совпадение >= minMatches меток метрик.
 */
export function looksLikeReport(text, settings) {
  if (!text) return false
  const first = firstLine(text)
  const markers = settings.report_marker_words || []
  if (markers.some((m) => first.toLowerCase().startsWith(m.toLowerCase()))) return true

  const min = settings.min_label_matches_without_marker || 7
  let matches = 0
  for (const m of settings.metrics || []) {
    for (const alias of [m.label, ...(m.aliases || [])]) {
      const re = labelRegex(alias)
      if (re.test(text)) {
        matches++
        break
      }
    }
  }
  return matches >= min
}

/**
 * Парсит сообщение-отчёт.
 * Возвращает: { ok, dateFrom, dateTo, metrics, extra, errors, raw }
 */
export function parseReport(text, settings, now = new Date()) {
  const raw = text || ''
  const lines = raw.split(/\r?\n/)
  const result = {
    ok: true,
    dateFrom: null,
    dateTo: null,
    metrics: {},
    extra: {},
    errors: [],
    raw,
  }

  // ---- 1. Дата из первой строки
  const first = lines[0] || ''
  const dateRes = parseDateHeader(first, now, settings)
  if (!dateRes.ok) {
    result.ok = false
    result.errors.push(dateRes.error)
    return result
  }
  result.dateFrom = dateRes.dateFrom
  result.dateTo = dateRes.dateTo

  // Валидация периода
  const maxDays = settings.max_days_back || 7
  const today = startOfDay(now)
  const df = new Date(dateRes.dateFrom)
  const dt = new Date(dateRes.dateTo)

  if (dt > today) {
    result.ok = false
    result.errors.push({ type: 'future', value: formatPeriod(dateRes.dateFrom, dateRes.dateTo) })
    return result
  }
  if (today - dt > maxDays * DAYS_MS) {
    result.ok = false
    result.errors.push({
      type: 'too_old',
      value: formatPeriod(dateRes.dateFrom, dateRes.dateTo),
      days: maxDays,
    })
    return result
  }

  // ---- 2. Метрики (со второй строки)
  const metrics = settings.metrics || []
  const usedLines = new Set([0])

  for (const m of metrics) {
    const aliases = [m.label, ...(m.aliases || [])]
    for (let i = 1; i < lines.length; i++) {
      if (usedLines.has(i)) continue
      const line = lines[i]
      const val = matchLine(line, aliases)
      if (val === null) continue
      usedLines.add(i)

      if (m.type === 'shows') {
        const parsed = parseShowsValue(val)
        result.metrics[m.key + '_count'] = parsed.count
        result.metrics[m.key + '_objects'] = parsed.objects
        result.metrics[m.key + '_raw'] = val || null
      } else if (m.type === 'money') {
        result.metrics[m.key] = parseMoney(val)
      } else {
        result.metrics[m.key] = parseInt0(val)
      }
      break
    }
  }

  // ---- 3. Экстра-строки (то что не распознано как метрика и не пустое)
  for (let i = 1; i < lines.length; i++) {
    if (usedLines.has(i)) continue
    const ln = lines[i].trim()
    if (!ln) continue
    // формат "Лейбл - значение" или "Лейбл значение"
    const m = ln.match(/^([\p{L}\d .()]+?)\s*[-–—:]\s*(.*)$/u) || ln.match(/^([\p{L}\d .()]+?)\s+(\d+.*)$/u)
    if (m) {
      const key = m[1].trim()
      const val = m[2].trim()
      result.extra[key] = val
    } else {
      // совсем нераспознанная строка
      result.extra[`_line_${i}`] = ln
    }
  }

  return result
}

/**
 * Парсит первую строку вида "Отчёт 17.04" / "Отчёт 17-19.04" / "Отчёт с 17.04 по 19.04".
 * Возвращает { ok, dateFrom: 'YYYY-MM-DD', dateTo, error }
 */
export function parseDateHeader(line, now, settings) {
  const l = (line || '').trim()
  const markers = (settings.report_marker_words || []).map((m) => m.toLowerCase())

  const low = l.toLowerCase()
  const hasMarker = markers.some((m) => low.startsWith(m))
  if (!hasMarker) {
    return { ok: false, error: { type: 'no_date', value: line } }
  }

  // Убираем маркер и "за", "от", "с"
  const markerRe = new RegExp('^(?:' + markers.map(escapeRe).join('|') + ')[:\\s]*', 'i')
  let rest = l.replace(markerRe, '').trim()
  rest = rest.replace(/^(?:за|от)\s+/i, '').trim()

  if (!rest) {
    return { ok: false, error: { type: 'no_date', value: line } }
  }

  // "с DD.MM по DD.MM" или "с DD.MM.YYYY по DD.MM.YYYY"
  let m = rest.match(/^с\s+(.+?)\s+по\s+(.+)$/i)
  if (m) {
    const a = parseSingleDate(m[1], now)
    const b = parseSingleDate(m[2], now)
    if (!a || !b) return { ok: false, error: { type: 'bad_date', value: rest } }
    return makeRange(a, b, rest)
  }

  // "DD-DD.MM" или "DD.MM-DD.MM" или "DD.MM.YYYY-DD.MM.YYYY"
  m = rest.match(/^(\d{1,2}(?:\.\d{1,2}(?:\.\d{2,4})?)?)\s*[-–—]\s*(\d{1,2}(?:\.\d{1,2}(?:\.\d{2,4})?)?)$/)
  if (m) {
    const aRaw = m[1]
    const bRaw = m[2]
    // Если "17-19.04" — у первой только день, берём месяц/год из второй
    let a, b
    if (aRaw.includes('.')) {
      a = parseSingleDate(aRaw, now)
    } else {
      b = parseSingleDate(bRaw, now)
      if (!b) return { ok: false, error: { type: 'bad_date', value: rest } }
      a = parseDayOnly(aRaw, b)
    }
    if (!b) b = parseSingleDate(bRaw, now)
    if (!a || !b) return { ok: false, error: { type: 'bad_date', value: rest } }
    return makeRange(a, b, rest)
  }

  // Одиночная дата
  const single = parseSingleDate(rest, now)
  if (!single) return { ok: false, error: { type: 'bad_date', value: rest } }
  return { ok: true, dateFrom: toIso(single), dateTo: toIso(single) }
}

function makeRange(a, b, rawValue) {
  if (a > b) {
    return { ok: false, error: { type: 'range_inverted', value: rawValue } }
  }
  return { ok: true, dateFrom: toIso(a), dateTo: toIso(b) }
}

// "17.04" / "17.04.2026" / "17.04.26" — без маркера, только тело даты
function parseSingleDate(s, now) {
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/)
  if (!m) return null
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10) - 1
  if (day < 1 || day > 31 || month < 0 || month > 11) return null
  let year
  if (m[3]) {
    year = parseInt(m[3], 10)
    if (year < 100) year += 2000
  } else {
    year = now.getFullYear()
    // Если получилась дата в будущем > 30 дней — пробуем прошлый год (случай декабрь/январь переход)
    const test = new Date(year, month, day)
    if (test - now > 30 * DAYS_MS) year -= 1
  }
  const d = new Date(year, month, day)
  if (d.getDate() !== day || d.getMonth() !== month) return null // 31.02
  return d
}

// "17" — день, месяц/год берём из reference даты (второй в диапазоне)
function parseDayOnly(s, refDate) {
  const day = parseInt(s.trim(), 10)
  if (!day || day < 1 || day > 31) return null
  const d = new Date(refDate.getFullYear(), refDate.getMonth(), day)
  if (d.getDate() !== day) return null
  return d
}

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function toIso(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatPeriod(fromIso, toIso) {
  if (fromIso === toIso) return formatRu(fromIso)
  return `${formatRu(fromIso)} – ${formatRu(toIso)}`
}

function formatRu(iso) {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function firstLine(t) {
  const i = t.indexOf('\n')
  return i === -1 ? t : t.slice(0, i)
}

/**
 * Строит regex для поиска метки в начале строки — "Метка - ..." / "Метка- ..." / "Метка: ..."
 */
function labelRegex(label) {
  return new RegExp('^\\s*' + escapeRe(label) + '\\s*[-–—:]?\\s*', 'iu')
}

function matchLine(line, aliases) {
  for (const alias of aliases) {
    const re = labelRegex(alias)
    const m = line.match(re)
    if (m) {
      return line.slice(m[0].length).trim()
    }
  }
  return null
}

function parseInt0(s) {
  const t = String(s || '').trim()
  if (!t) return 0
  // допустим числа с пробелами "1 000"
  const cleaned = t.replace(/\s+/g, '')
  const m = cleaned.match(/-?\d+/)
  return m ? parseInt(m[0], 10) : 0
}

/**
 * Парсит поле "Вал" / "Авансы": "500000", "500 000", "500к", "0.5млн", "150000 ₽"
 */
function parseMoney(s) {
  const t = String(s || '').trim().toLowerCase()
  if (!t) return 0
  const cleaned = t.replace(/[₽\s]/g, '').replace(',', '.')
  let m = cleaned.match(/^(-?\d+(?:\.\d+)?)(к|млн|m|k)?$/)
  if (m) {
    let n = parseFloat(m[1])
    const suf = m[2]
    if (suf === 'к' || suf === 'k') n *= 1000
    else if (suf === 'млн' || suf === 'm') n *= 1_000_000
    return Math.round(n)
  }
  return parseInt0(cleaned)
}

/**
 * Парсит "Показы (об)": "1(1) 1(2)" или просто "3"
 * Возвращает { count, objects }
 * count = сумма всех "внешних" чисел
 * objects = сумма чисел в скобках
 */
function parseShowsValue(s) {
  const t = String(s || '').trim()
  if (!t) return { count: 0, objects: null }
  let count = 0
  let objects = 0
  let foundObjects = false
  const re = /(\d+)(?:\s*\(\s*(\d+)\s*\))?/g
  let m
  while ((m = re.exec(t)) !== null) {
    count += parseInt(m[1], 10)
    if (m[2] !== undefined) {
      foundObjects = true
      objects += parseInt(m[2], 10)
    }
  }
  return { count, objects: foundObjects ? objects : null }
}
