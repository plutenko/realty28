import { useEffect, useState } from 'react'
import { fetchUnitsFromApi } from '../lib/fetchUnitsFromApi'
import { useAuth } from '../lib/authContext'
import CatalogTabs from '../components/CatalogTabs'

function formatRoomsKey(rooms, isCommercial, spanFloors) {
  if (isCommercial) return 'КП'
  if (Number(spanFloors) >= 2) return '2ур'
  if (rooms == null) return '?'
  if (rooms === 0) return 'Ст'
  return `${rooms}к`
}

function formatPriceShort(n) {
  const v = Number(n)
  if (!v || !Number.isFinite(v)) return '—'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, '')} млн`
  if (v >= 1_000) return `${Math.round(v / 1_000)} тыс`
  return Math.round(v).toLocaleString('ru-RU')
}

function commissionLabel(complex) {
  const type = String(complex?.realtor_commission_type || 'none')
  const value = Number(complex?.realtor_commission_value ?? 0)
  if (type === 'none' || value <= 0) return '—'
  if (type === 'percent') return `${value}% от цены`
  if (type === 'fixed_rub') return `${value.toLocaleString('ru-RU')} ₽ (фикс.)`
  if (type === 'rub_per_m2') return `${value.toLocaleString('ru-RU')} ₽/м²`
  return '—'
}

function commissionRange(complex, units) {
  const type = String(complex?.realtor_commission_type || 'none')
  const value = Number(complex?.realtor_commission_value ?? 0)
  if (type === 'none' || value <= 0 || !units?.length) return null
  const amounts = []
  for (const u of units) {
    const price = Number(u?.price ?? 0)
    const area = Number(u?.area ?? 0)
    let amt = null
    if (type === 'percent' && price > 0) amt = (price * value) / 100
    else if (type === 'fixed_rub') amt = value
    else if (type === 'rub_per_m2' && area > 0) amt = area * value
    if (amt != null && Number.isFinite(amt) && amt > 0) amounts.push(amt)
  }
  if (!amounts.length) return null
  const min = Math.min(...amounts)
  const max = Math.max(...amounts)
  return { min, max }
}

function handoverLabel(b) {
  const st = String(b?.handover_status || '').toLowerCase()
  if (st === 'delivered') return 'Сдан'
  const q = Number(b?.handover_quarter)
  const y = Number(b?.handover_year)
  if (Number.isFinite(q) && q >= 1 && q <= 4 && Number.isFinite(y) && y > 0) return `${q} кв. ${y}`
  return '—'
}

const ROOM_COLORS = {
  'КП': 'bg-orange-100 text-orange-700 border-orange-200',
  '2ур': 'bg-teal-100 text-teal-700 border-teal-200',
  'Ст': 'bg-purple-100 text-purple-700 border-purple-200',
  '1к': 'bg-blue-100 text-blue-700 border-blue-200',
  '2к': 'bg-green-100 text-green-700 border-green-200',
  '3к': 'bg-amber-100 text-amber-700 border-amber-200',
  '4к': 'bg-rose-100 text-rose-700 border-rose-200',
  '5к': 'bg-red-100 text-red-700 border-red-200',
}

export default function SummaryPage() {
  const { user, loading } = useAuth()
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    ;(async () => {
      const { data: allUnits } = await fetchUnitsFromApi()
      const byBuilding = new Map()
      for (const u of allUnits ?? []) {
        const bid = u.building?.id
        if (!bid) continue
        if (!byBuilding.has(bid)) byBuilding.set(bid, { building: u.building, units: [] })
        byBuilding.get(bid).units.push(u)
      }
      const tableRows = []
      for (const { building: b, units } of byBuilding.values()) {
        const c = b?.complex
        const d = c?.developer
        const available = units.filter((u) => {
          const s = String(u.status ?? '').toLowerCase()
          return s !== 'sold' && s !== 'booked' && s !== 'reserved'
        })
        const roomCounts = {}
        for (const u of available) {
          const key = formatRoomsKey(u.rooms, u.is_commercial, u.span_floors)
          roomCounts[key] = (roomCounts[key] || 0) + 1
        }
        const roomEntries = Object.entries(roomCounts)
          .sort((a, b) => {
            const order = (k) => k === 'КП' ? -2 : k === 'Ст' ? -1 : k === '2ур' ? 50 : k === '?' ? 100 : parseInt(k) || 99
            return order(a[0]) - order(b[0])
          })
        const commLabel = commissionLabel(c)
        const commRng = commissionRange(c, available)
        tableRows.push({
          id: b.id,
          developer: d?.name || '—',
          complex: c?.name || '—',
          building: b?.name || '—',
          address: b?.address || '',
          handover: handoverLabel(b),
          available: available.length,
          roomEntries,
          commLabel,
          commRng,
        })
      }
      tableRows.sort((a, b) =>
        a.developer.localeCompare(b.developer, 'ru') ||
        a.complex.localeCompare(b.complex, 'ru') ||
        a.building.localeCompare(b.building, 'ru', { numeric: true })
      )
      setRows(tableRows)
      setBusy(false)
    })()
  }, [])

  if (loading) return null

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <CatalogTabs />

      <div className="px-4 py-4">
        <h1 className="mb-4 text-xl font-bold text-gray-900">Сводка по объектам</h1>

        {busy ? (
          <p className="text-sm text-gray-400">Загрузка...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400">Нет данных</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Застройщик</th>
                  <th className="px-4 py-3">ЖК</th>
                  <th className="px-4 py-3">Дом</th>
                  <th className="px-4 py-3">Сдача</th>
                  <th className="px-4 py-3 text-center">В продаже</th>
                  <th className="px-4 py-3">Комнатность</th>
                  <th className="px-4 py-3">Вознаграждение</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => {
                  const prev = i > 0 ? rows[i - 1] : null
                  const sameDev = prev?.developer === r.developer
                  const sameComplex = sameDev && prev?.complex === r.complex
                  return (
                    <tr
                      key={r.id}
                      className={`hover:bg-gray-50 transition ${
                        !sameDev && i > 0 ? 'border-t-2 border-gray-300' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-gray-800">{sameDev ? '' : r.developer}</td>
                      <td className="px-4 py-3 text-gray-800">{sameComplex ? '' : r.complex}</td>
                      <td className="px-4 py-3 text-gray-800 font-medium">
                        {r.building}
                        {r.address ? (
                          <div className="text-xs font-normal text-gray-500 mt-0.5">
                            {r.address}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{r.handover}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-semibold ${r.available > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                          {r.available}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {r.roomEntries.length === 0 ? (
                            <span className="text-gray-400">—</span>
                          ) : (
                            r.roomEntries.map(([key, count]) => (
                              <span
                                key={key}
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${
                                  ROOM_COLORS[key] || 'bg-gray-100 text-gray-600 border-gray-200'
                                }`}
                              >
                                <span>{key}</span>
                                <span className="font-bold">{count}</span>
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {r.commLabel === '—' ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <div>
                            <div className="text-xs text-gray-500">{r.commLabel}</div>
                            {r.commRng && (
                              <div className="text-sm font-semibold text-blue-700">
                                {r.commRng.min === r.commRng.max
                                  ? `${formatPriceShort(r.commRng.min)} ₽`
                                  : `${formatPriceShort(r.commRng.min)}–${formatPriceShort(r.commRng.max)} ₽`}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
