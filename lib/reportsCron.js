/**
 * Хелперы для cron-эндпоинтов отчётов.
 */

const DAY_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function localParts(date, timeZone = 'Asia/Yakutsk') {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]))
  const hour = p.hour === '24' ? 0 : +p.hour
  const year = +p.year
  const month = +p.month
  const day = +p.day
  const minute = +p.minute
  const dow = (p.weekday || '').toLowerCase().slice(0, 3) // 'mon', 'tue', ...
  return {
    year,
    month,
    day,
    hour,
    minute,
    dow,
    dateIso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

export function addDaysIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export function formatRu(iso) {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export function formatRuShort(iso) {
  const [_y, m, d] = iso.split('-')
  return `${d}.${m}`
}

/**
 * Возвращает true, если текущее weekend-окно (Пт+Сб+Вс той же недели, что и `now`)
 * захватывает переход через границу месяца. Используется как off-switch
 * для weekend-hold/sunday-strict: на стыке месяцев бойцы сдают отчёты
 * раздельно за каждый день, иначе помесячная статистика (revenue и пр.)
 * не сводится к календарному месяцу — батч из двух разных месяцев
 * хранится одной строкой в daily_reports и не делится корректно.
 */
export function weekendCrossesMonthBoundary(now, timeZone = 'Asia/Yakutsk') {
  const l = localParts(now, timeZone)
  const dow = DAY_ABBR.indexOf(l.dow) // sun=0, mon=1, ..., sat=6
  // Сдвиг до Пт текущей weekend-недели:
  //   Пн-Чт (1-4): впереди ближайший Пт — сдвиг +(5-dow);
  //   Пт (5): сегодня;
  //   Сб (6): вчера, -1;
  //   Вс (0): два дня назад, -2.
  const offsetToFri = dow >= 1 && dow <= 5 ? 5 - dow : dow === 6 ? -1 : -2
  const friIso = addDaysIso(l.dateIso, offsetToFri)
  const sunIso = addDaysIso(friIso, 2)
  return friIso.slice(0, 7) !== sunIso.slice(0, 7)
}

/**
 * Компактный формат периода для заголовка сводки:
 *   один месяц/год → «24-26.04»
 *   разные месяцы того же года → «28.04-02.05»
 *   разные годы → «28.12.2025-02.01.2026»
 */
export function formatRuPeriodCompact(fromIso, toIso) {
  if (fromIso === toIso) return formatRuShort(fromIso)
  const [fy, fm, fd] = fromIso.split('-')
  const [ty, tm, td] = toIso.split('-')
  if (fy === ty && fm === tm) return `${fd}-${td}.${fm}`
  if (fy === ty) return `${fd}.${fm}-${td}.${tm}`
  return `${fd}.${fm}.${fy}-${td}.${tm}.${ty}`
}

/**
 * Для вечернего напоминания определяет за какой день(и) ждём отчёт.
 * Пн-Чт → текущий день; Вс → батч Пт+Сб+Вс (range_batch_days, по умолчанию 3 дня назад включая сегодня).
 */
export function computeReminderPeriod(nowLocal, settings) {
  const askDays = new Set(settings.ask_days || ['mon', 'tue', 'wed', 'thu', 'sun'])
  if (!askDays.has(nowLocal.dow)) return null
  if (nowLocal.dow === 'sun') {
    const batchDays = settings.sunday_batch_days || 3
    const from = addDaysIso(nowLocal.dateIso, -(batchDays - 1))
    return { from, to: nowLocal.dateIso, isBatch: true }
  }
  return { from: nowLocal.dateIso, to: nowLocal.dateIso, isBatch: false }
}

/**
 * Для утренней сводки в 09:30 определяет за какой период.
 * Пн-Чт (утро) → вчера; Пт (утро) → вчерашний четверг; Пн (утро) → батч Пт-Вс.
 * Логика: сводка за тот день (или период), чьё окно только что закрылось.
 */
export function computeSummaryPeriod(nowLocal, settings) {
  const yesterday = addDaysIso(nowLocal.dateIso, -1)
  // JS Date.getUTCDay: 0=Sun. Вчера был Вс → сегодня Пн → батч Пт-Вс
  const [y, m, d] = yesterday.split('-').map(Number)
  const yesterdayDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const batchDays = settings.sunday_batch_days || 3
  if (yesterdayDow === 0) {
    // yesterday был Вс → батч: от (Вс - batchDays + 1) до Вс
    const from = addDaysIso(yesterday, -(batchDays - 1))
    return { from, to: yesterday, isBatch: true }
  }
  return { from: yesterday, to: yesterday, isBatch: false }
}

export function isHoliday(iso, settings) {
  const holidays = settings.holidays || []
  return holidays.includes(iso) || holidays.some((h) => iso.endsWith(h)) // поддержим 'MM-DD' без года
}

export function fmtMoney(n) {
  return Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ')
}
