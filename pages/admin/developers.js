import { useEffect, useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import ImageUploadField from '../../components/admin/ImageUploadField'
import { supabase } from '../../lib/supabaseClient'
import { getDevelopers } from '../../lib/supabaseQueries'

const MESSENGER_OPTIONS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'max', label: 'Max' },
]

function messengerLabel(value) {
  return MESSENGER_OPTIONS.find((o) => o.value === value)?.label ?? value
}

function sortManagers(list) {
  return [...(list ?? [])].sort(
    (a, b) => new Date(a.created_at ?? 0) - new Date(b.created_at ?? 0)
  )
}

export default function AdminDevelopersPage() {
  const [rows, setRows] = useState([])
  const [name, setName] = useState('')
  const [shortDescription, setShortDescription] = useState('')
  const [editId, setEditId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const [mgrEditId, setMgrEditId] = useState('')
  const [mgrName, setMgrName] = useState('')
  const [mgrPhone, setMgrPhone] = useState('')
  const [mgrShortDescription, setMgrShortDescription] = useState('')
  const [mgrMessenger, setMgrMessenger] = useState('telegram')
  const [mgrBusy, setMgrBusy] = useState(false)

  async function load() {
    if (!supabase) return
    const { data, error } = await getDevelopers(supabase)
    if (error) {
      setMsg(error.message)
      return
    }
    setRows(data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const r = rows.find((x) => x.id === editId)
    if (r) {
      setName(r.name ?? '')
      setShortDescription(r.short_description ?? '')
    } else {
      setName('')
      setShortDescription('')
    }
  }, [editId, rows])

  useEffect(() => {
    setMgrEditId('')
    setMgrName('')
    setMgrPhone('')
    setMgrShortDescription('')
    setMgrMessenger('telegram')
  }, [editId])

  const currentManagers = useMemo(() => {
    const r = rows.find((x) => x.id === editId)
    return sortManagers(r?.developer_managers)
  }, [rows, editId])

  async function onCreate(e) {
    e.preventDefault()
    if (!supabase || !name.trim()) return
    setBusy(true)
    setMsg('')
    const { error } = await supabase.from('developers').insert({
      name: name.trim(),
      short_description: shortDescription.trim() || null,
    })
    setBusy(false)
    if (error) setMsg(error.message)
    else {
      setName('')
      setShortDescription('')
      load()
    }
  }

  async function onUpdate(e) {
    e.preventDefault()
    if (!supabase || !editId) return
    setBusy(true)
    setMsg('')
    const { error } = await supabase
      .from('developers')
      .update({
        name: name.trim(),
        short_description: shortDescription.trim() || null,
      })
      .eq('id', editId)
    setBusy(false)
    if (error) setMsg(error.message)
    else load()
  }

  async function onDelete(id) {
    if (!supabase) return
    const okFirst = confirm('Удалить застройщика?')
    if (!okFirst) return
    const okSecond = confirm(
      'Подтвердите удаление: действие необратимо и может затронуть связанные записи.'
    )
    if (!okSecond) return
    const { error } = await supabase.from('developers').delete().eq('id', id)
    if (error) setMsg(error.message)
    else {
      if (editId === id) setEditId('')
      load()
    }
  }

  function resetManagerForm() {
    setMgrEditId('')
    setMgrName('')
    setMgrPhone('')
    setMgrShortDescription('')
    setMgrMessenger('telegram')
  }

  function startEditManager(m) {
    setMgrEditId(m.id)
    setMgrName(m.name ?? '')
    setMgrPhone(m.phone ?? '')
    setMgrShortDescription(m.short_description ?? '')
    setMgrMessenger(messengerValue(m.messenger))
  }

  function messengerValue(raw) {
    const v = String(raw || 'telegram')
    if (v === 'whatsapp' || v === 'telegram' || v === 'max') return v
    return 'telegram'
  }

  async function onSaveManager(e) {
    e.preventDefault()
    if (!supabase || !editId) return
    if (!mgrName.trim()) {
      setMsg('Укажите имя менеджера')
      return
    }
    setMgrBusy(true)
    setMsg('')
    const payload = {
      developer_id: editId,
      name: mgrName.trim(),
      phone: mgrPhone.trim() || null,
      short_description: mgrShortDescription.trim() || null,
      messenger: mgrMessenger,
    }
    let error
    if (mgrEditId) {
      const res = await supabase
        .from('developer_managers')
        .update({
          name: payload.name,
          phone: payload.phone,
          short_description: payload.short_description,
          messenger: payload.messenger,
        })
        .eq('id', mgrEditId)
      error = res.error
    } else {
      const res = await supabase.from('developer_managers').insert(payload)
      error = res.error
    }
    setMgrBusy(false)
    if (error) {
      setMsg(error.message)
      return
    }
    resetManagerForm()
    load()
  }

  async function onDeleteManager(id) {
    if (!supabase) return
    const okFirst = confirm('Удалить менеджера?')
    if (!okFirst) return
    const okSecond = confirm(
      'Подтвердите удаление: запись будет удалена без возможности восстановления.'
    )
    if (!okSecond) return
    const { error } = await supabase.from('developer_managers').delete().eq('id', id)
    if (error) setMsg(error.message)
    else {
      if (mgrEditId === id) resetManagerForm()
      load()
    }
  }

  return (
    <AdminLayout title="Застройщики">
      {msg ? (
        <p className="mb-4 rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-200">
          {msg}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-900/80">
            <tr>
              <th className="p-3">Название</th>
              <th className="p-3">Описание</th>
              <th className="w-40 p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-800/80">
                <td className="p-3 font-medium">{r.name}</td>
                <td className="p-3 text-slate-400">{r.short_description || '—'}</td>
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
        onSubmit={editId ? onUpdate : onCreate}
        className="mt-8 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
      >
        <h2 className="text-lg font-semibold">
          {editId ? 'Редактирование' : 'Новый застройщик'}
        </h2>
        {editId ? (
          <button
            type="button"
            onClick={() => setEditId('')}
            className="text-sm text-slate-400 hover:text-white"
          >
            Создать нового вместо редактирования
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
          <label className="block text-xs text-slate-400">Краткое описание</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            rows={3}
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
          />
        </div>
        {editId ? (
          <ImageUploadField
            entityType="developer"
            entityId={editId}
            label="Загрузить изображение (опционально)"
            onUploaded={() => setMsg('Файл загружен')}
          />
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-blue-600 px-6 py-2 font-medium text-white disabled:opacity-50"
        >
          {editId ? 'Сохранить' : 'Создать'}
        </button>
      </form>

      {editId ? (
        <section className="mt-10 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-lg font-semibold">Менеджеры застройщика</h2>
          <p className="text-sm text-slate-400">
            Контактные лица: имя, телефон, краткое описание и предпочитаемый мессенджер для связи.
          </p>

          {currentManagers.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 bg-slate-900/80">
                  <tr>
                    <th className="p-2">Имя</th>
                    <th className="p-2">Телефон</th>
                    <th className="p-2">Описание</th>
                    <th className="p-2">Мессенджер</th>
                    <th className="w-36 p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {currentManagers.map((m) => (
                    <tr key={m.id} className="border-b border-slate-800/60">
                      <td className="p-2 font-medium">{m.name || '—'}</td>
                      <td className="p-2 text-slate-300">{m.phone || '—'}</td>
                      <td className="max-w-xs p-2 text-slate-400">
                        {m.short_description || '—'}
                      </td>
                      <td className="p-2">{messengerLabel(m.messenger)}</td>
                      <td className="p-2">
                        <button
                          type="button"
                          onClick={() => startEditManager(m)}
                          className="mr-2 text-blue-400 hover:underline"
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteManager(m.id)}
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
          ) : (
            <p className="text-sm text-slate-500">Менеджеров пока нет — добавьте первого ниже.</p>
          )}

          <form
            onSubmit={onSaveManager}
            className="space-y-3 rounded-xl border border-slate-700/80 bg-slate-950/50 p-4"
          >
            <h3 className="text-sm font-semibold text-slate-200">
              {mgrEditId ? 'Редактирование менеджера' : 'Новый менеджер'}
            </h3>
            {mgrEditId ? (
              <button
                type="button"
                onClick={resetManagerForm}
                className="text-xs text-slate-400 hover:text-white"
              >
                Отменить редактирование и добавить нового
              </button>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-slate-400">Имя</label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                  value={mgrName}
                  onChange={(e) => setMgrName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400">Телефон</label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                  value={mgrPhone}
                  onChange={(e) => setMgrPhone(e.target.value)}
                  placeholder="+7 …"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400">Краткое описание</label>
              <textarea
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                rows={2}
                value={mgrShortDescription}
                onChange={(e) => setMgrShortDescription(e.target.value)}
                placeholder="Например: отдел продаж, корп. клиенты"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400">Мессенджер для связи</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                value={mgrMessenger}
                onChange={(e) => setMgrMessenger(e.target.value)}
              >
                {MESSENGER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {mgrMessenger === 'max' && (
                <p className="mt-1 text-xs text-amber-400">
                  Max не открывается по номеру телефона. В поле «Телефон» вставьте ссылку на диалог (например: https://max.ru/u/username)
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={mgrBusy}
              className="rounded-xl bg-blue-600 px-6 py-2 font-medium text-white disabled:opacity-50"
            >
              {mgrEditId ? 'Сохранить менеджера' : 'Добавить менеджера'}
            </button>
          </form>
        </section>
      ) : null}
    </AdminLayout>
  )
}
