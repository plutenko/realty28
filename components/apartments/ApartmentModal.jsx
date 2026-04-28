import { useEffect, useState } from 'react'
import {
  calcCommission,
  entranceFromPosition,
  formatHandover,
  formatPriceRub,
  formatRooms as formatRoomsBase,
} from '../../lib/format'
import FavoriteHeart from './FavoriteHeart'

const formatRooms = (rooms) => formatRoomsBase(rooms, { long: true })

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
  const raw = String(phone ?? '').trim()
  if (raw.startsWith('http')) return raw
  return null
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

export default function ApartmentModal({ unit, onClose, onAddToCollection, isSelected, collectionView = false, floorPlanUrl = null }) {
  // Источник URL поэтажного плана: поле unit.floor_plan_url (из /api/units)
  // или переданный prop (для страниц, где поле ещё не подключено).
  const effectiveFloorPlanUrl = unit?.floor_plan_url || floorPlanUrl
  const [zoomedSrc, setZoomedSrc] = useState(null)
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

  const entranceRaw =
    unit?.entrance ??
    entranceFromPosition(unit?.position, b?.units_per_entrance) ??
    null
  const entrance = entranceRaw != null && Number(entranceRaw) > 0 ? Number(entranceRaw) : 1
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
            {c?.website_url ? (
              <p className="text-sm mt-0.5">
                <a
                  href={c.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {c.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              </p>
            ) : null}
            {formatHandover(b) ? (
              <p className="text-xs text-gray-500 mt-0.5">
                Сдача: {formatHandover(b)}
              </p>
            ) : null}
            {b?.address ? (
              <p className="text-xs text-gray-500 mt-0.5">
                📍 {b.address}
              </p>
            ) : null}
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
            {unit?.has_renovation ? (
              <span className="rounded-lg bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
                С ремонтом
              </span>
            ) : null}
            {onAddToCollection && (
              <FavoriteHeart
                selected={isSelected}
                onToggle={() => onAddToCollection(unit.id)}
              />
            )}
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
                  className="mx-auto max-h-[400px] cursor-zoom-in object-contain p-2"
                  onClick={() => setZoomedSrc(unit.layout_image_url)}
                  title="Нажмите чтобы увеличить"
                />
              </div>
            </div>
          )}

          {/* Floor plan (поэтажный план) */}
          {effectiveFloorPlanUrl && unit?.floor != null && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-700">
                Поэтажный план — этаж {unit.floor}
              </h3>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={effectiveFloorPlanUrl}
                  alt={`Поэтажный план, этаж ${unit.floor}`}
                  className="mx-auto max-h-[400px] cursor-zoom-in object-contain p-2"
                  onClick={() => setZoomedSrc(effectiveFloorPlanUrl)}
                  title="Нажмите чтобы увеличить"
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
                  className="mx-auto max-h-[400px] cursor-zoom-in object-contain p-2"
                  onClick={() => setZoomedSrc(unit.finish_image_url)}
                  title="Нажмите чтобы увеличить"
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
            <DetailItem label="Этаж" value={`${unit?.floor ?? '—'}${b?.floors ? ` из ${b.floors}` : ''}`} />
            <DetailItem label="Подъезд" value={entrance ?? '—'} />
            <DetailItem label="Площадь" value={`${unit?.area ?? '—'} м²`} />
            <DetailItem label="Номер кв." value={unit?.number ?? '—'} />
            <DetailItem label="Застройщик" value={d?.name ?? '—'} />
          </div>

          {/* Commission */}
          {!collectionView && (
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-sm text-gray-600">Вознаграждение</div>
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

        </div>
      </div>
      {zoomedSrc && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setZoomedSrc(null)}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setZoomedSrc(null)
            }}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="Закрыть"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedSrc}
            alt=""
            className="max-h-[95vh] max-w-[95vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
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
