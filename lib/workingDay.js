/**
 * TTL approve-подтверждения устройства риелтора.
 * Approve действителен 7 дней (168 часов) с момента подтверждения руководителем.
 * Сутки считаются условно — важен только промежуток между approved_at и now.
 */

const APPROVE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * true — если approve ещё действителен (< 7 дней с approve_at).
 */
export function approveStillValid(approvedAt) {
  if (!approvedAt) return false
  const t = approvedAt instanceof Date ? approvedAt : new Date(approvedAt)
  if (Number.isNaN(t.getTime())) return false
  return Date.now() - t.getTime() < APPROVE_TTL_MS
}
