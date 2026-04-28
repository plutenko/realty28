export function formatPriceRub(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0,
  }).format(Number(n))
}

export function formatRooms(rooms, { long = false } = {}) {
  if (rooms == null) return '—'
  if (rooms === 0) return 'Студия'
  if (rooms >= 5) return '5+'
  return long ? `${rooms}-комн.` : `${rooms}к`
}

export function pricePerM2(unit) {
  const price = Number(unit?.price)
  const area = Number(unit?.area)
  if (Number.isFinite(price) && Number.isFinite(area) && area > 0) {
    return Math.round(price / area)
  }
  return null
}

export function formatHandover(b) {
  const s = String(b?.handover_status || '').toLowerCase()
  if (s === 'completed' || s === 'delivered' || s === 'сдан') return 'Сдан'
  const q = b?.handover_quarter
  const y = b?.handover_year
  if (!y) return null
  return q ? `${q} кв. ${y}` : `${y}`
}

export function entranceFromPosition(position, unitsPerEntrance) {
  const p = Number(position)
  if (!Number.isFinite(p) || p <= 0) return null
  const arr = Array.isArray(unitsPerEntrance)
    ? unitsPerEntrance.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
    : []
  if (!arr.length) return null
  let start = 1
  for (let i = 0; i < arr.length; i += 1) {
    const size = arr[i]
    const end = start + size - 1
    if (p >= start && p <= end) return i + 1
    start = end + 1
  }
  return null
}

export function calcCommission(unit) {
  const complex = unit?.building?.complex
  const type = String(complex?.realtor_commission_type || 'none')
  const value = Number(complex?.realtor_commission_value ?? 0)
  const price = Number(unit?.price ?? 0)
  const area = Number(unit?.area ?? 0)

  if (type === 'none' || value <= 0) {
    return { text: 'Нет вознаграждения', amount: null }
  }

  if (type === 'percent') {
    if (price <= 0) return { text: 'Вознаграждение не рассчитано', amount: null }
    const amount = (price * value) / 100
    return {
      text: `${formatPriceRub(amount)} ₽ (${value}% от цены)`,
      amount,
    }
  }

  if (type === 'fixed_rub') {
    return {
      text: `${formatPriceRub(value)} ₽ (фикс.)`,
      amount: value,
    }
  }

  if (type === 'rub_per_m2') {
    if (area <= 0) return { text: 'Вознаграждение не рассчитано', amount: null }
    const amount = area * value
    return {
      text: `${formatPriceRub(amount)} ₽ (${formatPriceRub(value)} ₽/м²)`,
      amount,
    }
  }

  return { text: 'Нет вознаграждения', amount: null }
}
