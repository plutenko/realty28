import { useEffect } from 'react'

function formatPriceRub(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(n))
}

function formatRooms(rooms) {
  if (rooms == null) return '—'
  if (rooms === 0) return 'Студия'
  return rooms >= 5 ? '5+' : `${rooms}-комн.`
}

function normalizePhone(phone) {
  return String(phone ?? '').replace(/[^\d+]/g, '')
}

function toWhatsAppLink(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}` : null
}

function toTelegramLink(phone) {
  const raw = String(phone ?? '').trim()
  if (raw.startsWith('@')) return `https://t.me/${raw.slice(1)}`
  return null
}

function toMaxLink(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  return digits ? `https://max.ru/${digits}` : null
}

function getMessengerLink(messenger, phone) {
  const type = String(messenger || '').toLowerCase()
  if (type === 'whatsapp') return toWhatsAppLink(phone)
  if (type === 'telegram') return toTelegramLink(phone)
  if (type === 'max') return toMaxLink(phone)
  return null
}

function messengerLabel(messenger) {
  const type = String(messenger || '').toLowerCase()
  if (type === 'whatsapp') return 'WhatsApp'
  if (type === 'telegram') return 'Telegram'
  if (type === 'max') return 'Max'
  return 'Мессенджер'
}

function calcCommission(unit) {
  const complex = unit?.building?.complex
  const type = String(complex?.realtor_commission_type || 'none')
  const value = Number(complex?.realtor_commission_value ?? 0)
  const price = Number(unit?.price ?? 0)
  const area = Number(unit?.area ?? 0)

  if (type === 'none' || value <= 0) return { text: 'Нет комиссии', amount: null }
  if (type === 'percent') {
    if (price <= 0) return { text: 'Комиссия не рассчитана', amount: null }
    const amount = (price * value) / 100
    return { text: `${formatPriceRub(amount)} ₽ (${value}% от цены)`, amount }
  }
  if (type === 'fixed_rub') return { text: `${formatPriceRub(value)} ₽ (фикс.)`, amount: value }
  if (type === 'rub_per_m2') {
    if (area <= 0) return { text: 'Комиссия не рассчитана', amount: null }
    const amount = area * value
    return { text: `${formatPriceRub(amount)} ₽ (${formatPriceRub(value)} ₽/м²)`, amount }
  }
  return { text: 'Нет комиссии', amount: null }
}

function entranceFromPosition(position, unitsPerEntrance) {
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

export default function ApartmentModal({ unit, onClose, onAddToCollection, isSelected, collectionView = false }) {
  const b = unit?.building
  const c = b?.complex
  const d = c?.developer

  const status = unit?.status ?? 'available'
  const statusKey = String(status).toLowerCase()
  const sold = statusKey === 'sold'
  const booked = statusKey === 'booked' || statusKey === 'reserved'
  const commission = calcCommission(unit)
  const managers = (d?.developer_managers ?? [])
    .slice()
    .sort((a, b) => new Date(a?.created_at ?? 0) - new Date(b?.created_at ?? 0))
    .slice(0, 4)

  const entrance = entranceFromPosition(unit?.position, b?.units_per_entrance) ?? null
  const pricePerM2 = unit?.price_per_meter
    ? Number(unit.price_per_meter)
    : unit?.price && unit?.area && Number(unit.area) > 0
    ? Math.round(Number(unit.price) / Number(unit.area))
    : null

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4 rounded-t-2xl">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {formatRooms(unit?.rooms)} · {unit?.area ?? '—'} м²
            </h2>
            <p className="text-sm text-gray-500">
              {c?.name ?? '—'} · {b?.name ?? '—'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                sold
                  ? 'bg-gray-200 text-gray-600'
                  : booked
                  ? 'bg-amber-200 text-amber-900'
                  : 'bg-green-100 text-green-800'
              }`}
            >
              {sold ? 'Продано' : booked ? 'На брони' : 'В продаже'}
            </span>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Layout image */}
          {unit?.layout_image_url && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-700">Планировка</h3>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={unit.layout_image_url}
                  alt="Планировка"
                  className="mx-auto max-h-[400px] object-contain p-2"
                />
              </div>
            </div>
          )}

          {/* Finish image */}
          {unit?.finish_image_url && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-700">Отделка</h3>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={unit.finish_image_url}
                  alt="Отделка"
                  className="mx-auto max-h-[400px] object-contain p-2"
                />
              </div>
            </div>
          )}

          {/* Price block */}
          <div className="rounded-xl bg-blue-50 p-4">
            <div className="text-2xl font-bold text-blue-700">
              {formatPriceRub(unit?.price)} ₽
            </div>
            {pricePerM2 && (
              <div className="mt-1 text-sm text-blue-600">
                {formatPriceRub(pricePerM2)} ₽/м²
              </div>
            )}
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <DetailItem label="Комнаты" value={formatRooms(unit?.rooms)} />
            <DetailItem label="Этаж" value={unit?.floor ?? '—'} />
            <DetailItem label="Подъезд" value={entrance ?? '—'} />
            <DetailItem label="Площадь" value={`${unit?.area ?? '—'} м²`} />
            <DetailItem label="Номер кв." value={unit?.number ?? '—'} />
            <DetailItem label="Застройщик" value={d?.name ?? '—'} />
          </div>

          {/* Commission */}
          {!collectionView && (
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-sm text-gray-600">Комиссия риелтора</div>
              <div className={`mt-1 text-base font-semibold ${commission.amount != null ? 'text-blue-700' : 'text-gray-500'}`}>
                {commission.text}
              </div>
            </div>
          )}

          {/* Contacts */}
          {!collectionView && managers.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-gray-700">Контакты застройщика</h3>
              <div className="space-y-2">
                {managers.map((m) => {
                  const phone = m?.phone || ''
                  const tel = normalizePhone(phone)
                  const messengerUrl = getMessengerLink(m?.messenger, phone)
                  return (
                    <div key={m.id} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3">
                      <div>
                        <div className="font-semibold text-gray-900">{m?.name || 'Менеджер'}</div>
                        {m?.short_description && (
                          <div className="text-xs text-gray-500">{m.short_description}</div>
                        )}
                        {phone && <div className="mt-1 text-sm text-gray-600">{phone}</div>}
                      </div>
                      <div className="flex gap-2">
                        {phone && (
                          <a
                            href={tel ? `tel:${tel}` : undefined}
                            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 transition"
                          >
                            Позвонить
                          </a>
                        )}
                        {messengerUrl && (
                          <a
                            href={messengerUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition"
                          >
                            {messengerLabel(m?.messenger)}
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Add to collection button */}
          {onAddToCollection && (
            <button
              type="button"
              onClick={() => onAddToCollection(unit.id)}
              className={`w-full rounded-xl py-3 text-sm font-semibold transition ${
                isSelected
                  ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {isSelected ? 'Убрать из подборки' : 'Добавить в подборку'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailItem({ label, value }) {
  return (
    <div className="rounded-xl bg-gray-50 px-4 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-gray-900">{value}</div>
    </div>
  )
}
