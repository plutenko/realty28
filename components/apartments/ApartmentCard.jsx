import { useState } from 'react'

function formatPriceRub(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0,
  }).format(Number(n))
}

function formatRooms(rooms) {
  if (rooms == null) return '—'
  if (rooms === 0) return 'Студия'
  return rooms >= 5 ? '5+' : `${rooms}к`
}

function normalizePhone(phone) {
  return String(phone ?? '').replace(/[^\d+]/g, '')
}

function toWhatsAppLink(phone) {
  const raw = String(phone ?? '').trim()
  if (!raw) return null
  if (raw.startsWith('http')) return raw
  const digits = raw.replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}` : null
}

function toTelegramLink(phone) {
  const raw = String(phone ?? '').trim()
  if (!raw) return null
  if (raw.startsWith('@')) return `https://t.me/${raw.slice(1)}`
  if (raw.startsWith('http')) return raw
  // По номеру телефона: https://t.me/+79656708911
  const digits = raw.replace(/[^\d+]/g, '')
  if (digits) return `https://t.me/${digits.startsWith('+') ? digits : '+' + digits}`
  return null
}

function toMaxLink(phone) {
  const raw = String(phone ?? '').trim()
  if (raw.startsWith('http')) return raw
  return null
}

function getMessengerLink(messenger, phone, messengerContact) {
  const type = String(messenger || '').toLowerCase()
  // Если задан отдельный контакт мессенджера — используем его, иначе номер
  const target = String(messengerContact || '').trim() || phone
  if (type === 'whatsapp') return toWhatsAppLink(target)
  if (type === 'telegram') return toTelegramLink(target)
  if (type === 'max') return toMaxLink(target)
  return null
}

function messengerLabel(messenger) {
  const type = String(messenger || '').toLowerCase()
  if (type === 'whatsapp') return 'WhatsApp'
  if (type === 'telegram') return 'Telegram'
  if (type === 'max') return 'Max'
  return 'Мессенджер'
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

function pricePerM2(unit) {
  const price = Number(unit?.price)
  const area = Number(unit?.area)
  if (Number.isFinite(price) && Number.isFinite(area) && area > 0) {
    return Math.round(price / area)
  }
  return null
}

function formatHandover(b) {
  const s = String(b?.handover_status || '').toLowerCase()
  if (s === 'completed' || s === 'delivered' || s === 'сдан') return 'Сдан'
  const q = b?.handover_quarter
  const y = b?.handover_year
  if (!y) return null
  return q ? `${q} кв. ${y}` : `${y}`
}

export default function ApartmentCard({ unit, collectionView = false, listView = false, displayFlags = null }) {
  const [contactsOpen, setContactsOpen] = useState(false)
  const b = unit?.building
  const c = b?.complex
  const d = c?.developer

  const showComplexName = displayFlags?.showComplexName !== false
  const showDeveloperName = displayFlags?.showDeveloperName !== false
  const showAddress = displayFlags?.showAddress !== false

  const status = unit?.status ?? 'available'
  const statusKey = String(status).toLowerCase()
  const sold = statusKey === 'sold'
  const booked = statusKey === 'booked' || statusKey === 'reserved'
  const commission = calcCommission(unit)
  const managers = (d?.developer_managers ?? [])
    .slice()
    .sort((a, b) => new Date(a?.created_at ?? 0) - new Date(b?.created_at ?? 0))
    .slice(0, 2)

  const entranceRaw =
    unit?.entrance ??
    entranceFromPosition(unit?.position, b?.units_per_entrance) ??
    null
  const entrance = entranceRaw != null && Number(entranceRaw) > 0 ? Number(entranceRaw) : 1

  return (
    <div
      className={`rounded-xl bg-white p-4 shadow transition hover:shadow-lg ${
        listView ? '' : 'hover:scale-105'
      } ${
        sold ? 'ring-1 ring-gray-300' : booked ? 'ring-1 ring-amber-300' : 'ring-1 ring-green-200'
      } ${listView && unit?.layout_image_url ? 'flex gap-4' : ''}`}
    >
      {listView && unit?.layout_image_url && (
        <div className="w-56 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={unit.layout_image_url}
            alt="Планировка"
            className="mx-auto h-full max-h-56 w-full object-contain p-2"
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {showComplexName && (
            <div className="truncate text-base font-semibold text-gray-900">
              {c?.name ?? '—'}
            </div>
          )}
          <div className={`truncate text-sm text-gray-600 ${!showComplexName ? 'text-base font-semibold text-gray-900' : ''}`}>
            Корпус: {b?.name ?? '—'}
          </div>
          {showAddress && b?.address ? (
            <div className="truncate text-sm text-gray-600">
              📍 {b.address}
            </div>
          ) : null}
          {showDeveloperName && (
            <div className="truncate text-sm text-gray-600">
              Застройщик: {d?.name ?? '—'}
            </div>
          )}
          {formatHandover(b) && (
            <div className="truncate text-sm text-gray-600">
              Сдача: {formatHandover(b)}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <div
            className={`rounded-lg px-2 py-1 text-xs font-semibold ${
              sold
                ? 'bg-gray-300 text-gray-600'
                : booked
                ? 'bg-amber-300 text-amber-900'
                : 'bg-green-400 text-white'
            }`}
          >
            {sold ? 'Продано' : booked ? 'На брони' : 'В продаже'}
          </div>
          {unit?.has_renovation ? (
            <div className="rounded-lg bg-indigo-100 px-2 py-1 text-xs font-semibold text-indigo-700">
              С ремонтом
            </div>
          ) : null}
        </div>
      </div>

      {!listView && unit?.layout_image_url && (
        <div className="mb-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={unit.layout_image_url}
            alt="Планировка"
            className="mx-auto max-h-44 object-contain p-2"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-sm text-gray-700">
        <div>
          № квартиры: <span className="font-semibold text-gray-900">{unit?.number ?? '—'}</span>
        </div>
        <div>
          Комнаты: <span className="font-semibold text-gray-900">{formatRooms(unit?.rooms)}</span>
        </div>
        <div>
          Этаж: <span className="font-semibold text-gray-900">{unit?.floor ?? '—'}{b?.floors ? ` из ${b.floors}` : ''}</span>
        </div>
        <div>
          Подъезд:{' '}
          <span className="font-semibold text-gray-900">
            {entrance != null ? entrance : '—'}
          </span>
        </div>
        <div>
          Площадь: <span className="font-semibold text-gray-900">{unit?.area ?? '—'} м²</span>
        </div>
        <div>
          Цена: <span className="whitespace-nowrap font-semibold text-gray-900">{formatPriceRub(unit?.price)}{' ₽'}</span>
        </div>
        <div>
          Цена за м²: <span className="whitespace-nowrap font-semibold text-gray-900">{formatPriceRub(pricePerM2(unit))}{' ₽'}</span>
        </div>
      </div>
      {!collectionView && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-left text-sm">
          <span className="block text-gray-600">Вознаграждение:</span>
          <span
            className={`block font-semibold break-words ${
              commission.amount != null ? 'text-blue-700' : 'text-gray-600'
            }`}
          >
            {commission.text}
          </span>
        </div>
      )}

      {!collectionView && (
      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-left text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <span className="block text-gray-600">Контакты застройщика:</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setContactsOpen((v) => !v)
            }}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-gray-700 hover:bg-slate-100"
          >
            {contactsOpen ? 'Скрыть' : 'Показать'}
          </button>
        </div>
        {contactsOpen ? (
          managers.length === 0 ? (
            <span className="mt-2 block text-gray-500">Менеджеры не добавлены</span>
          ) : (
            <div className="mt-2 space-y-2">
              {managers.map((m) => {
                const phone = m?.phone || ''
                const tel = normalizePhone(phone)
                const messengerUrl = getMessengerLink(m?.messenger, phone, m?.messenger_contact)
                return (
                  <div key={m.id} className="rounded-md border border-slate-200 bg-white px-2 py-2">
                    <div className="font-semibold text-gray-900">{m?.name || 'Менеджер'}</div>
                    {m?.short_description ? (
                      <div className="text-xs text-gray-500">{m.short_description}</div>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {phone ? (
                        <a
                          href={tel ? `tel:${tel}` : undefined}
                          className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500"
                        >
                          Позвонить
                        </a>
                      ) : null}
                      {messengerUrl ? (
                        <a
                          href={messengerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border border-slate-300 px-2 py-1 text-xs text-gray-700 hover:bg-slate-50"
                        >
                          {messengerLabel(m?.messenger)}
                        </a>
                      ) : null}
                      {phone ? <span className="text-xs text-gray-600">{phone}</span> : null}
                    </div>
                  </div>
                )
              })}
              {(d?.developer_managers?.length ?? 0) > 2 ? (
                <div className="text-xs text-gray-500">
                  Ещё менеджеров: {(d?.developer_managers?.length ?? 0) - 2}
                </div>
              ) : null}
            </div>
          )
        ) : null}
      </div>
      )}
      </div>
    </div>
  )
}

