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
            return s !== 'sold' && s !== 'booked'
          })
          // Count by rooms
          const roomCounts = {}
          for (const u of available) {
            const key = formatRooms(u.rooms)
            roomCounts[key] = (roomCounts[key] || 0) + 1
          }
          const roomsSummary = Object.entries(roomCounts)
            .sort((a, b) => {
              const na = a[0] === 'Ст' ? -1 : parseInt(a[0]) || 99
              const nb = b[0] === 'Ст' ? -1 : parseInt(b[0]) || 99
              return na - nb
            })
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ')

          tableRows.push({
            id: b.id,
            developer: dev?.name || '—',
            complex: c.name || '—',
            building: b.name || '—',
            handover: handoverLabel(b),
            total: allUnits.length,
            available: available.length,
            roomsSummary: roomsSummary || '—',
          })
        }
      }
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
                <th className="px-4 py-3 text-center">Всего</th>
                <th className="px-4 py-3 text-center">В продаже</th>
                <th className="px-4 py-3">Комнатность</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-900/50 transition">
                  <td className="px-4 py-3 text-slate-200">{r.developer}</td>
                  <td className="px-4 py-3 text-slate-200">{r.complex}</td>
                  <td className="px-4 py-3 text-slate-200 font-medium">{r.building}</td>
                  <td className="px-4 py-3 text-slate-300">{r.handover}</td>
                  <td className="px-4 py-3 text-center text-slate-400">{r.total}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-semibold ${r.available > 0 ? 'text-green-400' : 'text-slate-500'}`}>
                      {r.available}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{r.roomsSummary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  )
}
