/**
 * Парсинг ежедневного отчёта риелтора.
 *
 * Формат:
 *   Отчёт 17.04                      <- маркер + дата (одиночная / с годом / диапазон)
 *   Хз - 7                           <- метрика
 *   Встречи - 2
 *   ...
 */

/**
 * Классифицирует сообщение:
 *   'report'   — начинается с маркера "Отчёт" → полная обработка
 *   'absence'  — начинается с маркера отсутствия (Выходной/Отпуск/...)
 *   'template' — нет маркера, но >= min_label_matches_without_marker меток → hint без реакции
 *   'none'     — обычный трёп, игнорируем
 */
export function classifyMessage(text, settings) {
  if (!text) return 'none'
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const first = (lines[0] || '').toLowerCase()

  // Absence имеет приоритет над report: риелтор может написать "Отчёт 21.04\nБольничный".
  // Фактически это больничный за 21.04, а не нулевой отчёт. Сканируем все строки.
  const absence = settings.absence_markers || {}
  const absenceWords = Object.keys(absence).map((w) => w.toLowerCase())
  for (const line of lines) {
    const low = line.toLowerCase()
    if (absenceWords.some((w) => low.startsWith(w))) return 'absence'
  }

  const reportMarkers = (settings.report_marker_words || []).map((m) => m.toLowerCase())
  if (reportMarkers.some((m) => first.startsWith(m))) return 'report'

  const min = settings.min_label_matches_without_marker || 7
  let matches = 0
  for (const m of settings.metrics || []) {
    for (const alias of [m.label, ...(m.aliases || [])]) {
      if (labelRegex(alias).test(text)) {
        matches++
        break
      }
    }
  }
  return matches >= min ? 'template' : 'none'
}

// Обратная совместимость: оставляем старое имя (всё, что не 'none')
export function looksLikeReport(text, settings) {
  return classifyMessage(text, settings) !== 'none'
}

/**
 * Парсит сообщение-отметку отсутствия: "Выходной" / "Отпуск 14-21.04" / "Больничный 17.04"
 * Возвращает { ok, absenceType, dateFrom, dateTo, errors }
 * Если дата не указана — considers сегодня.
 */
export function parseAbsence(text, settings, now = new Date()) {
  const nowLocal = getLocalParts(now, settings.timezone || 'Asia/Yakutsk')
  const absence = settings.absence_markers || {}
  const absenceEntries = Object.entries(absence)

  const lines = (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  // Строка с absence-маркером может быть не первой (если выше стоит "Отчёт DD.MM").
  let matched = null
  let matchedRest = ''
  for (const line of lines) {
    const low = line.toLowerCase()
    for (const [word, type] of absenceEntries) {
      if (low.startsWith(word.toLowerCase())) {
        matched = { word, type }
        matchedRest = line.slice(word.length).trim().replace(/^(?:за|от)\s+/i, '').trim()
        break
      }
    }
    if (matched) break
  }

  if (!matched) {
    return { ok: false, errors: [{ type: 'no_date', value: lines[0] || '' }] }
  }

  // Строка с absence-маркером (любая по номеру) исключается из разбора метрик.
  const absenceLineIdx = lines.findIndex((line) => {
    const low = line.toLowerCase()
    return absenceEntries.some(([word]) => low.startsWith(word.toLowerCase()))
  })

  function buildOk(dateFrom, dateTo, dateLineIdx) {
    const skip = new Set()
    if (absenceLineIdx >= 0) skip.add(absenceLineIdx)
    if (dateLineIdx != null && dateLineIdx >= 0) skip.add(dateLineIdx)
    const { metrics, extra } = extractMetricsFromLines(lines, settings, { skipIndexes: skip })
    return {
      ok: true,
      absenceType: matched.type,
      dateFrom,
      dateTo,
      metrics,
      extra,
      errors: [],
    }
  }

  // 1) Дата вместе с маркером ("Больничный 21.04")
  if (matchedRest) {
    const headerLine = `${settings.report_marker_words?.[0] || 'Отчёт'} ${matchedRest}`
    const parsed = parseDateHeader(headerLine, nowLocal, settings)
    if (parsed.ok) {
      return buildOk(parsed.dateFrom, parsed.dateTo, absenceLineIdx)
    }
    // если рядом с маркером что-то не распарсилось — падаем, а не молча берём default
    return { ok: false, errors: [parsed.error] }
  }

  // 2) Дата в отдельной строке "Отчёт DD.MM" (частый случай: "Отчёт 21.04\nБольничный")
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseDateHeader(lines[i], nowLocal, settings)
    if (parsed.ok) {
      return buildOk(parsed.dateFrom, parsed.dateTo, i)
    }
  }

  // 3) Ни даты у маркера, ни отдельной строки с "Отчёт DD.MM" — берём дату по времени
  const def = computeDefaultAbsenceDate(nowLocal, settings)
  if (!def) {
    return { ok: false, errors: [{ type: 'no_date', value: matched.word }] }
  }
  return buildOk(def, def, null)
}

/**
 * Парсит сообщение-отчёт.
 * Возвращает: { ok, dateFrom, dateTo, metrics, extra, errors, raw }
 */
export function parseReport(text, settings, now = new Date(), options = {}) {
  const { allowClosedWindow = false } = options
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

  const nowLocal = getLocalParts(now, settings.timezone || 'Asia/Yakutsk')

  // ---- 1. Дата из первой строки
  const first = lines[0] || ''
  const dateRes = parseDateHeader(first, nowLocal, settings)
  if (!dateRes.ok) {
    result.ok = false
    result.errors.push(dateRes.error)
    return result
  }
  result.dateFrom = dateRes.dateFrom
  result.dateTo = dateRes.dateTo

  const periodText = formatPeriod(dateRes.dateFrom, dateRes.dateTo)

  // Ширина диапазона — не больше max_range_days (дефолт 3 для батча Пт+Сб+Вс)
  const maxRange = settings.max_range_days || 3
  const rangeDays = diffDaysIso(dateRes.dateFrom, dateRes.dateTo) + 1
  if (rangeDays > maxRange) {
    result.ok = false
    result.errors.push({
      type: 'range_too_wide',
      value: periodText,
      max_days: maxRange,
      actual_days: rangeDays,
    })
    return result
  }

  // Диапазон (более 1 дня) разрешён только для выходных (по умолчанию Пт+Сб+Вс).
  if (rangeDays > 1) {
    const allowed = new Set(settings.range_allowed_days || [5, 6, 0]) // JS getUTCDay: 5=Fri, 6=Sat, 0=Sun
    let cur = dateRes.dateFrom
    while (cur <= dateRes.dateTo) {
      const { year, month, day } = isoToParts(cur)
      const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
      if (!allowed.has(dow)) {
        result.ok = false
        result.errors.push({
          type: 'range_not_weekend_only',
          value: periodText,
        })
        return result
      }
      cur = addDaysIso(cur, 1)
    }
  }

  // ---- 2. Окно приёма по последнему дню диапазона
  // Окно за день D: [D 12:00, (D+1) summary_time). После summary_time — сводка сформирована, не принимаем.
  // allowClosedWindow — если руководитель разблокировал этот день через админку (report_day_overrides).
  if (!allowClosedWindow) {
    const winRes = checkAcceptWindow(dateRes.dateTo, nowLocal, settings)
    if (winRes.state !== 'ok') {
      result.ok = false
      result.errors.push({
        type: winRes.state,
        value: periodText,
        open_at: winRes.openAt,
        close_at: winRes.closeAt,
      })
      return result
    }
  }

  // ---- 3-4. Метрики + экстра-строки (со второй строки)
  const { metrics: mOut, extra: eOut } = extractMetricsFromLines(lines, settings, {
    skipIndexes: new Set([0]),
  })
  result.metrics = mOut
  result.extra = eOut

  return result
}

/**
 * Вытаскивает метрики и экстра-строки из произвольных строк текста.
 * Используется и в parseReport (обычный отчёт), и в parseAbsence — когда
 * при больничном/отпуске/т.п. сотрудник всё равно указал «Вал - 75000»
 * и мы хотим сохранить значение в БД.
 */
export function extractMetricsFromLines(lines, settings, { skipIndexes } = {}) {
  const metrics = settings.metrics || []
  const usedLines = new Set(skipIndexes || [])
  const outMetrics = {}
  const outExtra = {}

  for (const m of metrics) {
    const aliases = [m.label, ...(m.aliases || [])]
    for (let i = 0; i < lines.length; i++) {
      if (usedLines.has(i)) continue
      const line = lines[i]
      const val = matchLine(line, aliases)
      if (val === null) continue
      usedLines.add(i)

      if (m.type === 'shows') {
        const parsed = parseShowsValue(val)
        outMetrics[m.key + '_count'] = parsed.count
        outMetrics[m.key + '_objects'] = parsed.objects
        outMetrics[m.key + '_raw'] = val || null
      } else if (m.type === 'money') {
        outMetrics[m.key] = parseMoney(val)
      } else {
        outMetrics[m.key] = parseInt0(val)
      }
      break
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (usedLines.has(i)) continue
    const ln = (lines[i] || '').trim()
    if (!ln) continue
    const m =
      ln.match(/^([\p{L}\d .()]+?)\s*[-–—:]\s*(.*)$/u) ||
      ln.match(/^([\p{L}\d .()]+?)\s+(\d+.*)$/u)
    if (m) {
      outExtra[m[1].trim()] = m[2].trim()
    } else {
      outExtra[`_line_${i}`] = ln
    }
  }

  return { metrics: outMetrics, extra: outExtra }
}

/**
 * Парсит первую строку: "Отчёт 17.04" / "Отчёт 17-19.04" / "Отчёт с 17.04 по 19.04".
 * Получает nowLocal = {year, month, day, ...} в локальной TZ.
 */
export function parseDateHeader(line, nowLocal, settings) {
  const l = (line || '').trim()
  const markers = (settings.report_marker_words || []).map((m) => m.toLowerCase())

  const low = l.toLowerCase()
  const hasMarker = markers.some((m) => low.startsWith(m))
  if (!hasMarker) {
    return { ok: false, error: { type: 'no_date', value: line } }
  }

  const markerRe = new RegExp('^(?:' + markers.map(escapeRe).join('|') + ')[:\\s]*', 'i')
  let rest = l.replace(markerRe, '').trim()
  rest = rest.replace(/^(?:за|от)\s+/i, '').trim()

  if (!rest) {
    return { ok: false, error: { type: 'no_date', value: line } }
  }

  // "с DD.MM по DD.MM"
  let m = rest.match(/^с\s+(.+?)\s+по\s+(.+)$/i)
  if (m) {
    const a = parseSingleDate(m[1], nowLocal)
    const b = parseSingleDate(m[2], nowLocal)
    if (!a || !b) return { ok: false, error: { type: 'bad_date', value: rest } }
    return makeRange(a, b, rest)
  }

  // "DD-DD.MM" / "DD.MM-DD.MM"
  m = rest.match(/^(\d{1,2}(?:\.\d{1,2}(?:\.\d{2,4})?)?)\s*[-–—]\s*(\d{1,2}(?:\.\d{1,2}(?:\.\d{2,4})?)?)$/)
  if (m) {
    const aRaw = m[1]
    const bRaw = m[2]
    let a, b
    if (aRaw.includes('.')) {
      a = parseSingleDate(aRaw, nowLocal)
    } else {
      b = parseSingleDate(bRaw, nowLocal)
      if (!b) return { ok: false, error: { type: 'bad_date', value: rest } }
      a = parseDayOnly(aRaw, b)
    }
    if (!b) b = parseSingleDate(bRaw, nowLocal)
    if (!a || !b) return { ok: false, error: { type: 'bad_date', value: rest } }
    return makeRange(a, b, rest)
  }

  // Одиночная дата
  const single = parseSingleDate(rest, nowLocal)
  if (!single) return { ok: false, error: { type: 'bad_date', value: rest } }
  const iso = partsToIso(single)
  return { ok: true, dateFrom: iso, dateTo: iso }
}

function makeRange(a, b, rawValue) {
  const aIso = partsToIso(a)
  const bIso = partsToIso(b)
  if (aIso > bIso) {
    return { ok: false, error: { type: 'range_inverted', value: rawValue } }
  }
  return { ok: true, dateFrom: aIso, dateTo: bIso }
}

// "17.04" / "17.04.2026" / "17.04.26" — возвращает {year, month, day} (month 1-based)
function parseSingleDate(s, nowLocal) {
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/)
  if (!m) return null
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  if (day < 1 || day > 31 || month < 1 || month > 12) return null

  let year
  if (m[3]) {
    year = parseInt(m[3], 10)
    if (year < 100) year += 2000
  } else {
    year = nowLocal.year
    // Если дата в +30 дней будущего относительно "сейчас" — вероятно прошлый год (Янв/Дек переход)
    const candidate = partsToIso({ year, month, day })
    const nowIso = partsToIso(nowLocal)
    if (diffDaysIso(nowIso, candidate) > 30) year -= 1
  }
  if (!isValidDate(year, month, day)) return null
  return { year, month, day }
}

// "17" — день, месяц/год берём из refParts
function parseDayOnly(s, refParts) {
  const day = parseInt(s.trim(), 10)
  if (!day || day < 1 || day > 31) return null
  if (!isValidDate(refParts.year, refParts.month, day)) return null
  return { year: refParts.year, month: refParts.month, day }
}

function isValidDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function partsToIso({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Парсит ISO "YYYY-MM-DD" в {year, month, day}.
 */
function isoToParts(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return { year: y, month: m, day: d }
}

function addDaysIso(iso, n) {
  const { year, month, day } = isoToParts(iso)
  const dt = new Date(Date.UTC(year, month - 1, day))
  dt.setUTCDate(dt.getUTCDate() + n)
  return partsToIso({ year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() })
}

function diffDaysIso(fromIso, toIso) {
  const a = isoToParts(fromIso)
  const b = isoToParts(toIso)
  const da = Date.UTC(a.year, a.month - 1, a.day)
  const db = Date.UTC(b.year, b.month - 1, b.day)
  return Math.round((db - da) / 86400000)
}

/**
 * Получает локальные части даты в указанной TZ (например, Asia/Yakutsk).
 * Возвращает {year, month, day, hour, minute, minutesSinceMidnight, dateIso}.
 */
function getLocalParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  const hour = parts.hour === '24' ? 0 : parseInt(parts.hour, 10)
  const year = parseInt(parts.year, 10)
  const month = parseInt(parts.month, 10)
  const day = parseInt(parts.day, 10)
  const minute = parseInt(parts.minute, 10)
  return {
    year,
    month,
    day,
    hour,
    minute,
    minutesSinceMidnight: hour * 60 + minute,
    dateIso: partsToIso({ year, month, day }),
  }
}

/**
 * Проверяет, что отчёт за targetIso можно принять СЕЙЧАС.
 * Окно: [targetIso 12:00, (targetIso+1) summary_time) в локальной TZ.
 *
 * Возвращает {state, openAt, closeAt} где state:
 *   'ok' — внутри окна
 *   'future' — targetIso > сегодня
 *   'too_early' — targetIso == сегодня, ещё не наступило 12:00
 *   'too_old' — окно уже закрылось (включая случай когда сегодня > targetIso+1, и сегодня == targetIso+1 но после 09:30)
 */
function checkAcceptWindow(targetIso, nowLocal, settings) {
  const openTime = parseTime(settings.report_window_open || '12:00')
  const closeTime = parseTime(settings.summary_time || '09:30')

  const todayIso = nowLocal.dateIso
  const nextIso = addDaysIso(targetIso, 1)
  const openAt = `${targetIso} ${pad2(openTime.h)}:${pad2(openTime.m)}`
  const closeAt = `${nextIso} ${pad2(closeTime.h)}:${pad2(closeTime.m)}`

  // targetIso в будущем?
  if (targetIso > todayIso) {
    return { state: 'future', openAt, closeAt }
  }

  // targetIso == сегодня
  if (targetIso === todayIso) {
    const openMin = openTime.h * 60 + openTime.m
    if (nowLocal.minutesSinceMidnight < openMin) {
      return { state: 'too_early', openAt, closeAt }
    }
    return { state: 'ok', openAt, closeAt }
  }

  // targetIso < сегодня
  // Окно открыто только если сегодня == targetIso+1 и сейчас < close_time
  if (todayIso === nextIso) {
    const closeMin = closeTime.h * 60 + closeTime.m
    if (nowLocal.minutesSinceMidnight < closeMin) {
      return { state: 'ok', openAt, closeAt }
    }
  }
  return { state: 'too_old', openAt, closeAt }
}

/**
 * Подбирает "дату по умолчанию" для отсутствия без явной даты.
 * Берётся тот день, чьё окно приёма сейчас открыто:
 *   - сейчас >= 12:00 → сегодня
 *   - сейчас < 09:30 → вчера (всё ещё окно приёма вчерашнего)
 *   - 09:30–12:00 → null (окна нет, нужна явная дата)
 */
function computeDefaultAbsenceDate(nowLocal, settings) {
  const open = parseTime(settings.report_window_open || '12:00')
  const close = parseTime(settings.summary_time || '09:30')
  const openMin = open.h * 60 + open.m
  const closeMin = close.h * 60 + close.m
  if (nowLocal.minutesSinceMidnight >= openMin) return nowLocal.dateIso
  if (nowLocal.minutesSinceMidnight < closeMin) return addDaysIso(nowLocal.dateIso, -1)
  return null
}

function parseTime(s) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return { h: 12, m: 0 }
  return { h: Math.min(23, parseInt(m[1], 10)), m: Math.min(59, parseInt(m[2], 10)) }
}

function pad2(n) {
  return String(n).padStart(2, '0')
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

function labelRegex(label) {
  // 'm' — чтобы ^ матчился на начале каждой строки (нужно для classifyMessage с многострочным текстом)
  return new RegExp('^\\s*' + escapeRe(label) + '\\s*[-–—:]?\\s*', 'imu')
}

function matchLine(line, aliases) {
  for (const alias of aliases) {
    const re = labelRegex(alias)
    const m = line.match(re)
    if (m) return line.slice(m[0].length).trim()
  }
  return null
}

function parseInt0(s) {
  const t = String(s || '').trim()
  if (!t) return 0
  const cleaned = t.replace(/\s+/g, '')
  const m = cleaned.match(/-?\d+/)
  return m ? parseInt(m[0], 10) : 0
}

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
