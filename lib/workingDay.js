/**
 * Рабочий день с cutoff в 03:00 Asia/Yakutsk: сутки считаются от 03:00 до 03:00 следующего дня.
 * Если риелтор работает до 02:59 — approve, полученный днём ранее, ещё действителен.
 */

const DEFAULT_TZ = 'Asia/Yakutsk'
const CUTOFF_HOURS = 3

/**
 * Возвращает ключ рабочего дня в формате YYYY-MM-DD для переданной даты.
 * ts: Date | ISO string | number (unix ms)
 */
export function workingDayKey(ts, { timezone = DEFAULT_TZ, cutoffHours = CUTOFF_HOURS } = {}) {
  const t = ts instanceof Date ? ts : new Date(ts)
  if (Number.isNaN(t.getTime())) return null
  const shifted = new Date(t.getTime() - cutoffHours * 60 * 60 * 1000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(shifted)
}

/**
 * true — если approve ещё действителен (approve-день == сегодняшний рабочий день).
 */
export function approveStillValid(approvedAt, opts = {}) {
  if (!approvedAt) return false
  const approveDay = workingDayKey(approvedAt, opts)
  const todayDay = workingDayKey(new Date(), opts)
  return approveDay != null && approveDay === todayDay
}
