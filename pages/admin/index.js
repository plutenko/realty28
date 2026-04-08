import { useEffect, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { supabase } from '../../lib/supabaseClient'

function formatRooms(rooms) {
  if (rooms == null) return '?'
  if (rooms === 0) return 'Ст'
  return `${rooms}к`
}

function handoverLabel(b) {
  const st = String(b?.handover_status || '').toLowerCase()
  if (st === 'delivered') return 'Сдан'
  const q = Number(b?.handover_quarter)
  const y = Number(b?.handover_year)
  if (Number.isFinite(q) && q >= 1 && q <= 4 && Number.isFinite(y) && y > 0) {
    return `${q} кв. ${y}`
  }
  return '—'
}

const ROOM_COLORS = {
  'Ст': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  '1к': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  '2к': 'bg-green-500/20 text-green-300 border-green-500/30',
  '3к': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  '4к': 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  '5к': 'bg-red-500/20 text-red-300 border-red-500/30',
}

export default function AdminHomePage() {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    async function load() {
      if (!supabase) return
      const { data, error } = await supabase
        .from('complexes')
        .select(`
          id, name,
          developers ( id, name ),
          buildings (
            id, name, handover_status, handover_quarter, handover_year,
            units ( id, rooms, status )
          )
        `)
        .order('name')

      if (error) {
        console.error(error)
        setBusy(false)
        return
      }

      const tableRows = []
      for (const c of data ?? []) {
        const dev = Array.isArray(c.developers) ? c.developers[0] : c.developers
        for (const b of c.buildings ?? []) {
          const allUnits = b.units ?? []
          const available = allUnits.filter((u) => {
            const s = String(u.status ?? '').toLowerCase()
            return s !== 'sold' && s !== 'booked' && s !== 'reserved'
          })
          const roomCounts = {}
          for (const u of available) {
            const key = formatRooms(u.rooms)
            roomCounts[key] = (roomCounts[key] || 0) + 1
          }
          const roomEntries = Object.entries(roomCounts)
            .sort((a, b) => {
              const na = a[0] === 'Ст' ? -1 : parseInt(a[0]) || 99
              const nb = b[0] === 'Ст' ? -1 : parseInt(b[0]) || 99
              return na - nb
            })

          tableRows.push({
            id: b.id,
            developer: dev?.name || '—',
            complex: c.name || '—',
            building: b.name || '—',
            handover: handoverLabel(b),
            available: available.length,
            roomEntries,
          })
        }
      }

      // Sort: developer → complex → building
      tableRows.sort((a, b) =>
        a.developer.localeCompare(b.developer, 'ru') ||
        a.complex.localeCompare(b.complex, 'ru') ||
        a.building.localeCompare(b.building, 'ru', { numeric: true })
      )

      setRows(tableRows)
      setBusy(false)
    }
    load()
  }, [])

  return (
    <AdminLayout title="Сводка по объектам">
      {busy ? (
        <p className="text-sm text-slate-400">Загрузка...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">Нет данных. Добавьте застройщиков, ЖК и дома.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-900/80 text-xs text-slate-400 uppercase">
              <tr>
                <th className="px-4 py-3">Застройщик</th>
                <th className="px-4 py-3">ЖК</th>
                <th className="px-4 py-3">Дом</th>
                <th className="px-4 py-3">Сдача</th>
                <th className="px-4 py-3 text-center">В продаже</th>
                <th className="px-4 py-3">Комнатность</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((r, i) => {
                const prevRow = i > 0 ? rows[i - 1] : null
                const sameDev = prevRow?.developer === r.developer
                const sameComplex = sameDev && prevRow?.complex === r.complex
                return (
                  <tr
                    key={r.id}
                    className={`hover:bg-slate-900/50 transition ${
                      !sameDev && i > 0 ? 'border-t-2 border-slate-700' : ''
                    }`}
                  >
                    <td className="px-4 py-3 text-slate-200">
                      {sameDev ? '' : r.developer}
                    </td>
                    <td className="px-4 py-3 text-slate-200">
                      {sameComplex ? '' : r.complex}
                    </td>
                    <td className="px-4 py-3 text-slate-200 font-medium">{r.building}</td>
                    <td className="px-4 py-3 text-slate-300">{r.handover}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-semibold ${r.available > 0 ? 'text-green-400' : 'text-slate-500'}`}>
                        {r.available}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {r.roomEntries.length === 0 ? (
                          <span className="text-slate-500">—</span>
                        ) : (
                          r.roomEntries.map(([key, count]) => (
                            <span
                              key={key}
                              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${
                                ROOM_COLORS[key] || 'bg-slate-700/40 text-slate-300 border-slate-600'
                              }`}
                            >
                              <span>{key}</span>
                              <span className="font-bold">{count}</span>
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  )
}
