import { useEffect, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import ImageUploadField from '../../components/admin/ImageUploadField'
import { supabase } from '../../lib/supabaseClient'
import { getComplexes, getDevelopers } from '../../lib/supabaseQueries'

/** Первая обложка ЖК из images (entity_type = complex) */
async function fetchComplexCoverUrls(supabase, complexIds) {
  if (!supabase || !complexIds.length) return new Map()
  const { data, error } = await supabase
    .from('images')
    .select('entity_id, url')
    .eq('entity_type', 'complex')
    .in('entity_id', complexIds)
  if (error) {
    console.error('fetchComplexCoverUrls:', error)
    return new Map()
  }
  const map = new Map()
  for (const row of data ?? []) {
    if (row?.entity_id && !map.has(row.entity_id)) {
      map.set(row.entity_id, row.url)
    }
  }
  return map
}

export default function AdminComplexesPage() {
  const [rows, setRows] = useState([])
  const [developers, setDevelopers] = useState([])
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [developerId, setDeveloperId] = useState('')
  const [commissionType, setCommissionType] = useState('none')
  const [commissionValue, setCommissionValue] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [editId, setEditId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    if (!supabase) return
    const [c, d] = await Promise.all([
      getComplexes(supabase),
      getDevelopers(supabase),
    ])
    if (c.error) {
      setMsg(c.error.message)
      return
    }
    const list = c.data ?? []
    const ids = list.map((r) => r.id)
    const coverById = await fetchComplexCoverUrls(supabase, ids)
    setRows(
      list.map((r) => ({
        ...r,
        coverUrl: coverById.get(r.id) ?? null,
      }))
    )
    if (d.error) setMsg(d.error.message)
    else setDevelopers(d.data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const r = rows.find((x) => x.id === editId)
    if (r) {
      setName(r.name ?? '')
      setCity(r.city ?? '')
      setDeveloperId(r.developer_id ?? '')
      setCommissionType(r.realtor_commission_type ?? 'none')
      setCommissionValue(
        r.realtor_commission_value != null ? String(r.realtor_commission_value) : ''
      )
      setWebsiteUrl(r.website_url ?? '')
    } else {
      setName('')
      setCity('')
      setDeveloperId('')
      setCommissionType('none')
      setCommissionValue('')
      setWebsiteUrl('')
    }
  }, [editId, rows])

  async function onSubmit(e) {
    e.preventDefault()
    if (!supabase || !name.trim()) return
    setBusy(true)
    setMsg('')
    const payload = {
      name: name.trim(),
      city: city.trim() || null,
      developer_id: developerId || null,
      realtor_commission_type: commissionType,
      realtor_commission_value:
        commissionType === 'none' || commissionValue === ''
          ? null
          : Number(commissionValue),
      website_url: websiteUrl.trim() || null,
    }
    const q = editId
      ? supabase.from('complexes').update(payload).eq('id', editId)
      : supabase.from('complexes').insert(payload)
    const { error } = await q
    setBusy(false)
    if (error) setMsg(error.message)
    else {
      setEditId('')
      load()
    }
  }

  async function onDelete(id) {
    if (!supabase) return
    const okFirst = confirm('Удалить ЖК и связанные дома?')
    if (!okFirst) return
    const okSecond = confirm(
      'Подтвердите удаление: действие необратимо и может удалить связанные корпуса и квартиры.'
    )
    if (!okSecond) return
    const { error } = await supabase.from('complexes').delete().eq('id', id)
    if (error) setMsg(error.message)
    else {
      if (editId === id) setEditId('')
      load()
    }
  }

  const editingRow = rows.find((x) => x.id === editId)

  return (
    <AdminLayout title="Жилые комплексы">
      {msg ? (
        <p className="mb-4 rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-200">
          {msg}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-900/80">
            <tr>
              <th className="p-3 w-20">Фото</th>
              <th className="p-3">Название</th>
              <th className="p-3">Город</th>
              <th className="p-3">Застройщик</th>
              <th className="p-3">Сайт</th>
              <th className="p-3">Комиссия</th>
              <th className="p-3 w-40"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-800/80">
                <td className="p-3">
                  {r.coverUrl ? (
                    <img
                      src={r.coverUrl}
                      alt=""
                      className="h-12 w-16 rounded-md object-cover"
                    />
                  ) : (
                    <span className="text-xs text-slate-600">—</span>
                  )}
                </td>
                <td className="p-3 font-medium">{r.name}</td>
                <td className="p-3">{r.city || '—'}</td>
                <td className="p-3">{r.developers?.name || '—'}</td>
                <td className="p-3">
                  {r.website_url ? (
                    <a
                      href={r.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      {String(r.website_url).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '')}
                    </a>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="p-3 text-xs text-slate-300">
                  {r.realtor_commission_type === 'percent'
                    ? `${r.realtor_commission_value ?? 0}% от цены`
                    : r.realtor_commission_type === 'fixed_rub'
                      ? `${Number(r.realtor_commission_value ?? 0).toLocaleString('ru-RU')} ₽ фикс`
                      : r.realtor_commission_type === 'rub_per_m2'
                        ? `${Number(r.realtor_commission_value ?? 0).toLocaleString('ru-RU')} ₽/м²`
                        : 'Нет комиссии'}
                </td>
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

      <form
        onSubmit={onSubmit}
        className="mt-8 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
      >
        <h2 className="text-lg font-semibold">
          {editId ? 'Редактирование ЖК' : 'Новый ЖК'}
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
          <label className="block text-xs text-slate-400">Название</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400">Город</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400">Сайт ЖК</label>
          <input
            type="url"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            placeholder="https://..."
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400">Застройщик</label>
          <select
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={developerId}
            onChange={(e) => setDeveloperId(e.target.value)}
          >
            <option value="">— не выбран —</option>
            {developers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-slate-400">Тип комиссии</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={commissionType}
              onChange={(e) => setCommissionType(e.target.value)}
            >
              <option value="none">Нет комиссии (нет договора)</option>
              <option value="percent">% от цены квартиры</option>
              <option value="fixed_rub">Фиксированная сумма (₽)</option>
              <option value="rub_per_m2">Сумма в ₽ за м²</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400">
              Значение комиссии
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              disabled={commissionType === 'none'}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 disabled:opacity-50"
              value={commissionValue}
              onChange={(e) => setCommissionValue(e.target.value)}
              placeholder={
                commissionType === 'percent'
                  ? 'Например: 3'
                  : commissionType === 'fixed_rub'
                    ? 'Например: 100000'
                    : commissionType === 'rub_per_m2'
                      ? 'Например: 2000'
                      : 'Не требуется'
              }
            />
            <p className="mt-1 text-xs text-slate-500">
              {commissionType === 'percent'
                ? 'Комиссия = цена квартиры × значение / 100'
                : commissionType === 'fixed_rub'
                  ? 'Комиссия = фиксированная сумма в рублях'
                  : commissionType === 'rub_per_m2'
                    ? 'Комиссия = площадь квартиры × значение'
                    : 'Для этого ЖК комиссия не выплачивается'}
            </p>
          </div>
        </div>
        {editId ? (
          <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <p className="text-xs font-medium text-slate-300">
              Обложка для каталога /buildings
            </p>
            {editingRow?.coverUrl ? (
              <div className="max-w-md overflow-hidden rounded-lg border border-slate-700">
                <img
                  src={editingRow.coverUrl}
                  alt=""
                  className="max-h-48 w-full object-cover"
                />
              </div>
            ) : (
              <p className="text-xs text-slate-500">Обложка ещё не загружена</p>
            )}
            <ImageUploadField
              entityType="complex"
              entityId={editId}
              label="Загрузить или заменить изображение (JPEG, PNG, WebP)"
              onUploaded={() => {
                setMsg('Обложка сохранена — она появится в каталоге ЖК')
                load()
              }}
            />
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            После создания ЖК нажмите «Изменить», чтобы загрузить обложку.
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-blue-600 px-6 py-2 font-medium text-white disabled:opacity-50"
        >
          {editId ? 'Сохранить' : 'Создать'}
        </button>
      </form>
    </AdminLayout>
  )
}
