import { useEffect, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { supabase } from '../../lib/supabaseClient'
import { getBuildings, getComplexes } from '../../lib/supabaseQueries'

export default function AdminBuildingsPage() {
  const [rows, setRows] = useState([])
  const [complexes, setComplexes] = useState([])
  const [name, setName] = useState('')
  const [complexId, setComplexId] = useState('')
  const [handoverStatus, setHandoverStatus] = useState('planned')
  const [handoverQuarter, setHandoverQuarter] = useState('')
  const [handoverYear, setHandoverYear] = useState('')
  const [address, setAddress] = useState('')
  const [editId, setEditId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    if (!supabase) return
    const [b, c] = await Promise.all([
      getBuildings(supabase),
      getComplexes(supabase),
    ])
    if (b.error) setMsg(b.error.message)
    else setRows(b.data ?? [])
    if (c.error) setMsg(c.error.message)
    else setComplexes(c.data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const r = rows.find((x) => x.id === editId)
    if (r) {
      setName(r.name ?? '')
      setComplexId(r.complex_id ?? '')
      setHandoverStatus(
        String(r.handover_status || '').toLowerCase() === 'delivered'
          ? 'delivered'
          : 'planned'
      )
      setHandoverQuarter(
        r.handover_quarter != null && Number.isFinite(Number(r.handover_quarter))
          ? String(r.handover_quarter)
          : ''
      )
      setHandoverYear(
        r.handover_year != null && Number.isFinite(Number(r.handover_year))
          ? String(r.handover_year)
          : ''
      )
      setAddress(r.address ?? '')
    } else {
      setName('')
      setComplexId('')
      setHandoverStatus('planned')
      setHandoverQuarter('')
      setHandoverYear('')
      setAddress('')
    }
  }, [editId, rows])

  async function onSubmit(e) {
    e.preventDefault()
    if (!supabase || !name.trim() || !complexId) return
    setBusy(true)
    setMsg('')
    const payload = {
      name: name.trim(),
      complex_id: complexId,
      handover_status: handoverStatus === 'delivered' ? 'delivered' : 'planned',
      handover_quarter:
        handoverStatus === 'planned' && handoverQuarter
          ? Number(handoverQuarter)
          : null,
      handover_year:
        handoverStatus === 'planned' && handoverYear ? Number(handoverYear) : null,
      address: address.trim() || null,
    }

    let error = null
    const q = editId
      ? supabase.from('buildings').update(payload).eq('id', editId)
      : supabase.from('buildings').insert(payload)
    const fullRes = await q
    error = fullRes.error
    if (error && /handover_status|handover_quarter|handover_year|address/i.test(String(error.message || ''))) {
      const fallbackPayload = {
        name: payload.name,
        complex_id: payload.complex_id,
      }
      const fallbackQ = editId
        ? supabase.from('buildings').update(fallbackPayload).eq('id', editId)
        : supabase.from('buildings').insert(fallbackPayload)
      const fallbackRes = await fallbackQ
      error = fallbackRes.error
      if (!error) {
        setMsg(
          'Сохранено без статуса сдачи. Примените миграцию 019_buildings_handover_status.sql, чтобы хранить статус/срок сдачи.'
        )
      }
    }

    setBusy(false)
    if (error) setMsg(error.message)
    else {
      setEditId('')
      load()
    }
  }

  async function onDelete(id) {
    if (!supabase) return
    const okFirst = confirm('Удалить корпус и квартиры?')
    if (!okFirst) return
    const okSecond = confirm(
      'Подтвердите удаление: действие необратимо и может удалить все квартиры этого корпуса.'
    )
    if (!okSecond) return
    const { error } = await supabase.from('buildings').delete().eq('id', id)
    if (error) setMsg(error.message)
    else {
      if (editId === id) setEditId('')
      load()
    }
  }

  function formatHandover(r) {
    const st = String(r?.handover_status || '').toLowerCase()
    if (st === 'delivered') return 'Сдан'
    if (st === 'planned') {
      const q = Number(r?.handover_quarter)
      const y = Number(r?.handover_year)
      if (Number.isFinite(q) && q >= 1 && q <= 4 && Number.isFinite(y) && y > 0) {
        return `${q} кв. ${y}`
      }
      return 'Срок не указан'
    }
    return '—'
  }

  // Group buildings by developer → complex
  const groupedByDev = (() => {
    const byDev = new Map()
    for (const r of rows) {
      const devName = r.complexes?.developers?.name || '— без застройщика —'
      const cName = r.complexes?.name || '—'
      if (!byDev.has(devName)) byDev.set(devName, new Map())
      const byComplex = byDev.get(devName)
      if (!byComplex.has(cName)) byComplex.set(cName, [])
      byComplex.get(cName).push(r)
    }
    return [...byDev.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
      .map(([dev, byComplex]) => [
        dev,
        [...byComplex.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru')),
      ])
  })()

  return (
    <AdminLayout title="Дома / корпуса">
      {msg ? (
        <p className="mb-4 rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-200">
          {msg}
        </p>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="mb-8 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
      >
        <h2 className="text-lg font-semibold">
          {editId ? 'Редактирование' : 'Новый корпус'}
        </h2>
        {editId ? (
          <button
            type="button"
            onClick={() => setEditId('')}
            className="text-sm text-slate-400 hover:text-white"
          >
            Создать новый
          </button>
        ) : null}
        <div>
          <label className="block text-xs text-slate-400">ЖК</label>
          <select
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={complexId}
            onChange={(e) => setComplexId(e.target.value)}
            required
          >
            <option value="">— выберите —</option>
            {complexes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400">
            Название (Дом 1 / Литер А)
          </label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400">
            Адрес (точный для сданных, пересечение улиц для строящихся)
          </label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            placeholder="например: ул. Ленина, 10 или ул. Ленина / ул. Пушкина"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400">Статус дома</label>
          <select
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={handoverStatus}
            onChange={(e) => setHandoverStatus(e.target.value === 'delivered' ? 'delivered' : 'planned')}
          >
            <option value="planned">Срок сдачи</option>
            <option value="delivered">Сдан</option>
          </select>
        </div>
        {handoverStatus === 'planned' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-slate-400">Квартал</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                value={handoverQuarter}
                onChange={(e) => setHandoverQuarter(e.target.value)}
              >
                <option value="">— не указан —</option>
                <option value="1">1 квартал</option>
                <option value="2">2 квартал</option>
                <option value="3">3 квартал</option>
                <option value="4">4 квартал</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400">Год</label>
              <input
                type="number"
                min="2000"
                max="2100"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                placeholder="например: 2027"
                value={handoverYear}
                onChange={(e) => setHandoverYear(e.target.value)}
              />
            </div>
          </div>
        ) : null}
        <p className="text-xs text-slate-500">
          Этажи, подъезды и квартиры настраиваются на странице «Квартиры» (интерактивная
          шахматка).
        </p>
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-blue-600 px-6 py-2 font-medium text-white disabled:opacity-50"
        >
          {editId ? 'Сохранить' : 'Создать'}
        </button>
      </form>

      {groupedByDev.map(([devName, complexes]) => (
        <div key={devName} className="mb-8">
          <h2 className="mb-3 text-base font-bold uppercase tracking-wide text-amber-400">
            {devName}
          </h2>
          {complexes.map(([complexName, buildings]) => (
            <div key={complexName} className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-orange-300">{complexName}</h3>
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full table-fixed text-left text-sm">
                  <colgroup>
                    <col className="w-1/4" />
                    <col className="w-2/5" />
                    <col className="w-1/6" />
                    <col className="w-40" />
                  </colgroup>
                  <thead className="border-b border-slate-800 bg-slate-900/80">
                    <tr>
                      <th className="p-3">Название</th>
                      <th className="p-3">Адрес</th>
                      <th className="p-3">Сдача</th>
                      <th className="p-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildings.map((r) => (
                      <tr key={r.id} className={`border-b border-slate-800/80 ${editId === r.id ? 'bg-blue-950/30' : ''}`}>
                        <td className="p-3 font-medium">{r.name}</td>
                        <td className="p-3 text-slate-300 truncate">{r.address || <span className="text-slate-600">—</span>}</td>
                        <td className="p-3 text-slate-300">{formatHandover(r)}</td>
                        <td className="p-3">
                          <button
                            type="button"
                            onClick={() => setEditId(r.id)}
                            className="mr-2 text-blue-400 hover:underline"
                          >
                            Изменить
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(r.id)}
                            className="text-rose-400 hover:underline"
                          >
                            Удалить
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ))}
    </AdminLayout>
  )
}
