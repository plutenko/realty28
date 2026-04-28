import { useState } from 'react'
import { Phone, ImageOff } from 'lucide-react'
import {
  calcCommission,
  entranceFromPosition,
  formatHandover,
  formatPriceRub,
  formatRooms,
  pricePerM2,
} from '../../lib/format'
import FavoriteHeart from './FavoriteHeart'

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

export default function ApartmentCard({
  unit,
  selected = false,
  onToggleSelect,
  onOpenDetails,
  collectionView = false,
  listView = false,
  displayFlags = null,
}) {
  const [contactsOpen, setContactsOpen] = useState(false)
  const b = unit?.building
  const c = b?.complex
  const d = c?.developer

  const showComplexName = displayFlags?.showComplexName !== false
  const showDeveloperName = displayFlags?.showDeveloperName !== false
  const showAddress = displayFlags?.showAddress !== false

  const status = String(unit?.status ?? 'available').toLowerCase()
  const sold = status === 'sold'
  const booked = status === 'booked' || status === 'reserved'
  const commission = calcCommission(unit)
  const managers = (d?.developer_managers ?? [])
    .slice()
    .sort((a, b) => new Date(a?.created_at ?? 0) - new Date(b?.created_at ?? 0))
    .slice(0, 2)

  const entranceRaw =
    unit?.entrance ??
    entranceFromPosition(unit?.position, b?.units_per_entrance) ??
    null
  const entrance = entranceRaw != null && Number(entranceRaw) > 0 ? Number(entranceRaw) : null

  const photo = unit?.layout_image_url || unit?.finish_image_url || null
  const ppm = pricePerM2(unit)

  const summaryParts = [
    formatRooms(unit?.rooms),
    unit?.area != null ? `${unit.area} м²` : null,
    unit?.floor != null ? `${unit.floor}${b?.floors ? `/${b.floors}` : ''} эт.` : null,
    entrance != null ? `подъезд ${entrance}` : null,
  ].filter(Boolean)

  const metaLine1 = [
    showComplexName ? c?.name : null,
    showDeveloperName ? d?.name : null,
  ].filter(Boolean).join(' · ')

  const handover = formatHandover(b)

  const ringClass = sold
    ? 'ring-1 ring-gray-300'
    : booked
    ? 'ring-1 ring-amber-300'
    : selected
    ? 'ring-1 ring-rose-200'
    : 'ring-1 ring-green-200'

  const handleCardClick = () => {
    if (typeof onOpenDetails === 'function') onOpenDetails(unit)
  }

  const stopAndRun = (fn) => (e) => {
    e.stopPropagation()
    fn?.(e)
  }

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-xl shadow transition hover:shadow-lg ${
        selected ? 'bg-rose-50' : 'bg-white'
      } ${ringClass} ${listView ? 'sm:flex-row' : ''}`}
    >
      {/* В подборку — сердечко в правом верхнем углу с пульс-анимацией */}
      {!collectionView ? (
        <FavoriteHeart
          selected={selected}
          onToggle={stopAndRun(() => onToggleSelect?.(unit.id))}
          className="absolute right-2 top-2 z-10"
        />
      ) : null}

      {/* Фото / план — фикс. высота, плейсхолдер если нет */}
      <div
        className={`shrink-0 cursor-pointer overflow-hidden bg-gray-50 ${
          listView ? 'sm:w-56 sm:h-auto' : ''
        }`}
        onClick={handleCardClick}
      >
        <div className="flex h-48 w-full items-center justify-center">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt="Планировка"
              className="max-h-full max-w-full object-contain p-2"
            />
          ) : (
            <div className="flex flex-col items-center gap-1 text-gray-400">
              <ImageOff className="h-8 w-8" strokeWidth={1.5} />
              <span className="text-xs">План не загружен</span>
            </div>
          )}
        </div>
      </div>

      {/* Контент */}
      <div
        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-2 p-4"
        onClick={handleCardClick}
      >
        {/* Цена + статус */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-2xl font-bold leading-tight text-gray-900">
              {formatPriceRub(unit?.price)} ₽
            </div>
            {ppm != null ? (
              <div className="text-xs text-gray-500">{formatPriceRub(ppm)} ₽/м²</div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                sold
                  ? 'bg-gray-200 text-gray-600'
                  : booked
                  ? 'bg-amber-200 text-amber-900'
                  : 'bg-green-100 text-green-700'
              }`}
            >
              {sold ? 'Продано' : booked ? 'На брони' : 'В продаже'}
            </span>
            {unit?.has_renovation ? (
              <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                С ремонтом
              </span>
            ) : null}
          </div>
        </div>

        {/* Сводка одной строкой */}
        {summaryParts.length > 0 ? (
          <div className="text-sm text-gray-700">{summaryParts.join(' · ')}</div>
        ) : null}

        {/* Мета: ЖК + застройщик + сдача + адрес */}
        {(metaLine1 || handover || (showAddress && b?.address)) ? (
          <div className="space-y-0.5 text-xs text-gray-500">
            {metaLine1 ? <div className="truncate">{metaLine1}</div> : null}
            {handover ? <div>Сдача: {handover}</div> : null}
            {showAddress && b?.address ? (
              <div className="truncate">📍 {b.address}</div>
            ) : null}
          </div>
        ) : null}

        {/* Плашка вознаграждения */}
        {!collectionView && commission.amount != null ? (
          <div className="rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs">
            <span className="mr-1">💰</span>
            <span className="font-semibold text-emerald-700">{commission.text}</span>
          </div>
        ) : null}

        {/* Контакты застройщика — кнопка снизу */}
        {!collectionView ? (
          <button
            type="button"
            onClick={stopAndRun(() => setContactsOpen((v) => !v))}
            className={`mt-auto flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs font-medium transition ${
              contactsOpen
                ? 'bg-blue-50 text-blue-600'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
            title="Контакты застройщика"
          >
            <Phone className="h-3.5 w-3.5" />
            <span>{contactsOpen ? 'Скрыть контакты' : 'Контакты застройщика'}</span>
          </button>
        ) : null}

        {/* Раскрываемые контакты — без посредника-кнопки «Показать» */}
        {contactsOpen && !collectionView ? (
          <div
            className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            {managers.length === 0 ? (
              <div className="text-gray-500">Менеджеры не добавлены</div>
            ) : (
              <div className="space-y-1.5">
                {managers.map((m) => {
                  const phone = m?.phone || ''
                  const tel = normalizePhone(phone)
                  const messengerUrl = getMessengerLink(m?.messenger, phone, m?.messenger_contact)
                  return (
                    <div key={m.id} className="rounded bg-white px-2 py-1.5">
                      <div className="font-semibold text-gray-900">{m?.name || 'Менеджер'}</div>
                      {m?.short_description ? (
                        <div className="text-[11px] text-gray-500">{m.short_description}</div>
                      ) : null}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {phone ? (
                          <a
                            href={tel ? `tel:${tel}` : undefined}
                            className="rounded border border-blue-500 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                          >
                            Позвонить
                          </a>
                        ) : null}
                        {messengerUrl ? (
                          <a
                            href={messengerUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-slate-100"
                          >
                            {messengerLabel(m?.messenger)}
                          </a>
                        ) : null}
                        {phone ? <span className="text-[11px] text-gray-600">{phone}</span> : null}
                      </div>
                    </div>
                  )
                })}
                {(d?.developer_managers?.length ?? 0) > 2 ? (
                  <div className="text-[11px] text-gray-500">
                    Ещё менеджеров: {(d?.developer_managers?.length ?? 0) - 2}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
