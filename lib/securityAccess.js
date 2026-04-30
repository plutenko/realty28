import { approveStillValid } from './workingDay'

/**
 * Разбить риелторов на 4 группы по статусу доступа.
 * Используется на /admin/security и в /manager Security tab.
 *
 * Группы:
 *  - active: есть устройство + approve не просрочен (< 7 дней)
 *  - expired: есть устройство, но approve > 7 дней или ещё не давался
 *  - triedNotIn: нет устройства, но в pending_logins есть запись (пытался войти)
 *  - never: нет ни устройства, ни попытки
 *
 * Активный + expired: по строке на каждое устройство (мульти-устройства допустимы).
 * triedNotIn + never: по строке на риелтора.
 */
export function computeAccessGroups({ realtors, devices, pendingLogins }) {
  const realtorList = (realtors ?? []).filter((r) => r?.role === 'realtor')
  const realtorMap = new Map(realtorList.map((r) => [r.id, r]))

  const latestPendingByUser = new Map()
  for (const p of pendingLogins ?? []) {
    if (!p?.user_id) continue
    const prev = latestPendingByUser.get(p.user_id)
    if (!prev || new Date(p.created_at) > new Date(prev.created_at)) {
      latestPendingByUser.set(p.user_id, p)
    }
  }

  const active = []
  const expired = []
  const userIdsWithDevice = new Set()

  for (const d of devices ?? []) {
    const realtor = realtorMap.get(d?.user_id)
    if (!realtor) continue
    userIdsWithDevice.add(d.user_id)
    const row = { realtor, device: d }
    if (approveStillValid(d.last_approved_at)) active.push(row)
    else expired.push(row)
  }

  const triedNotIn = []
  const never = []
  for (const r of realtorList) {
    if (userIdsWithDevice.has(r.id)) continue
    const pending = latestPendingByUser.get(r.id) || null
    if (pending) triedNotIn.push({ realtor: r, pending })
    else never.push({ realtor: r })
  }

  const byName = (a, b) => (a.realtor.name || '').localeCompare(b.realtor.name || '', 'ru')
  const byLastUsed = (a, b) =>
    new Date(b.device?.last_used_at || 0) - new Date(a.device?.last_used_at || 0)
  const byPending = (a, b) =>
    new Date(b.pending?.created_at || 0) - new Date(a.pending?.created_at || 0)

  return {
    active: active.sort(byLastUsed),
    expired: expired.sort(byLastUsed),
    triedNotIn: triedNotIn.sort(byPending),
    never: never.sort(byName),
  }
}

export function fmtDate(d) {
  return d ? new Date(d).toLocaleString('ru-RU') : '—'
}
