import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import AdminLayout from '../../../components/admin/AdminLayout'
import { supabase } from '../../../lib/supabaseClient'

async function apiFetch(method, path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(path, opts)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Ошибка')
  return json
}

const DOW_OPTIONS = [
  { key: 'mon', label: 'Пн' },
  { key: 'tue', label: 'Вт' },
  { key: 'wed', label: 'Ср' },
  { key: 'thu', label: 'Чт' },
  { key: 'fri', label: 'Пт' },
  { key: 'sat', label: 'Сб' },
  { key: 'sun', label: 'Вс' },
]
// Соответствие для range_allowed_days (числа JS getUTCDay)
const DOW_NUM = [
  { n: 1, label: 'Пн' },
  { n: 2, label: 'Вт' },
  { n: 3, label: 'Ср' },
  { n: 4, label: 'Чт' },
  { n: 5, label: 'Пт' },
  { n: 6, label: 'Сб' },
  { n: 0, label: 'Вс' },
]

const ALLOWED_REACTIONS = ['👍', '👎', '❤️', '🔥', '👌', '🤔', '😢', '😁', '🎉', '🤝', '🫡']

const SectionTitle = ({ children }) => (
  <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-amber-300">{children}</h2>
)

const Label = ({ children }) => (
  <label className="mb-1 block text-xs font-medium text-slate-400">{children}</label>
)

const input = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500'
const textarea = input + ' font-mono'

export default function SettingsPage() {
  const [settings, setSettings] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const d = await apiFetch('GET', '/api/admin/reports/settings')
      setSettings(d.settings)
      setUpdatedAt(d.updated_at)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true)
    setError('')
    try {
      await apiFetch('PUT', '/api/admin/reports/settings', { settings })
      setSavedAt(new Date())
      setTimeout(() => setSavedAt(null), 2500)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function patch(partial) {
    setSettings((s) => ({ ...s, ...partial }))
  }
  function patchMsg(key, val) {
    setSettings((s) => ({ ...s, messages: { ...(s.messages || {}), [key]: val } }))
  }

  if (loading) {
    return <AdminLayout title="Настройки отчётов"><p className="text-sm text-slate-500">Загрузка...</p></AdminLayout>
  }
  if (!settings) {
    return <AdminLayout title="Настройки отчётов"><p className="text-sm text-red-400">Настройки не найдены в БД (reports_settings row id=1)</p></AdminLayout>
  }

  const askDays = new Set(settings.ask_days || [])
  const rangeAllowed = new Set(settings.range_allowed_days || [])

  return (
    <AdminLayout title="Настройки отчётов">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">
          Расписание, тексты сообщений, метрики. Изменения вступают в силу сразу после сохранения.
        </p>
        <div className="flex items-center gap-2">
          <Link href="/admin/reports" className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
            ← К отчётам
          </Link>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-5 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          {savedAt && <span className="text-xs text-emerald-400">✓ сохранено</span>}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
          {error}
        </div>
      )}

      {/* === Расписание === */}
      <SectionTitle>Расписание</SectionTitle>
      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <Label>Часовой пояс</Label>
          <input className={input} value={settings.timezone || ''}
            onChange={(e) => patch({ timezone: e.target.value })} />
        </div>
        <div>
          <Label>Окно открыто с</Label>
          <input type="time" className={input} value={settings.report_window_open || '12:00'}
            onChange={(e) => patch({ report_window_open: e.target.value })} />
        </div>
        <div>
          <Label>Дедлайн (напоминалка)</Label>
          <input type="time" className={input} value={settings.deadline_time || '09:00'}
            onChange={(e) => patch({ deadline_time: e.target.value })} />
        </div>
        <div>
          <Label>Сводка (окно закрывается)</Label>
          <input type="time" className={input} value={settings.summary_time || '09:30'}
            onChange={(e) => patch({ summary_time: e.target.value })} />
        </div>
        <div>
          <Label>Время напоминания</Label>
          <input type="time" className={input} value={settings.reminder_time || '20:00'}
            onChange={(e) => patch({ reminder_time: e.target.value })} />
        </div>
        <div className="md:col-span-3">
          <Label>В какие дни вечером спрашивать отчёт</Label>
          <div className="flex gap-2">
            {DOW_OPTIONS.map((d) => (
              <label key={d.key} className={`flex cursor-pointer items-center gap-1 rounded-lg border px-3 py-2 text-sm ${askDays.has(d.key) ? 'border-blue-500 bg-blue-500/10 text-white' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
                <input type="checkbox" className="h-3.5 w-3.5" checked={askDays.has(d.key)}
                  onChange={(e) => {
                    const next = new Set(askDays)
                    if (e.target.checked) next.add(d.key); else next.delete(d.key)
                    patch({ ask_days: Array.from(next) })
                  }} />
                {d.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <Label>Батч вс: дней назад</Label>
          <input type="number" min={1} max={7} className={input} value={settings.sunday_batch_days || 3}
            onChange={(e) => patch({ sunday_batch_days: parseInt(e.target.value, 10) || 3 })} />
        </div>
        <div>
          <Label>Макс. дней в диапазоне</Label>
          <input type="number" min={1} max={31} className={input} value={settings.max_range_days || 3}
            onChange={(e) => patch({ max_range_days: parseInt(e.target.value, 10) || 3 })} />
        </div>
        <div className="md:col-span-2">
          <Label>Какие дни разрешены в диапазоне (>1 дня)</Label>
          <div className="flex gap-2">
            {DOW_NUM.map((d) => (
              <label key={d.n} className={`flex cursor-pointer items-center gap-1 rounded-lg border px-3 py-2 text-sm ${rangeAllowed.has(d.n) ? 'border-blue-500 bg-blue-500/10 text-white' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
                <input type="checkbox" className="h-3.5 w-3.5" checked={rangeAllowed.has(d.n)}
                  onChange={(e) => {
                    const next = new Set(rangeAllowed)
                    if (e.target.checked) next.add(d.n); else next.delete(d.n)
                    patch({ range_allowed_days: Array.from(next).sort() })
                  }} />
                {d.label}
              </label>
            ))}
          </div>
        </div>
        <div className="md:col-span-4">
          <Label>Праздники (YYYY-MM-DD, через запятую или с новой строки)</Label>
          <textarea rows={3} className={textarea} value={(settings.holidays || []).join('\n')}
            onChange={(e) => patch({ holidays: e.target.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean) })} />
        </div>
      </div>

      {/* === Реакции / упоминания === */}
      <SectionTitle>Реакции и упоминания</SectionTitle>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label>Реакция "принят"</Label>
          <select className={input} value={settings.reaction_accepted || '👌'}
            onChange={(e) => patch({ reaction_accepted: e.target.value })}>
            {ALLOWED_REACTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <Label>Реакция "не принят"</Label>
          <select className={input} value={settings.reaction_rejected || '🤔'}
            onChange={(e) => patch({ reaction_rejected: e.target.value })}>
            {ALLOWED_REACTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <Label>Как упоминать риелторов в напоминалке</Label>
          <select className={input} value={settings.mention_mode || 'username_with_fallback'}
            onChange={(e) => patch({ mention_mode: e.target.value })}>
            <option value="username_with_fallback">@username → ссылка на ID (fallback)</option>
            <option value="link_only">Только ссылка на ID (без @username)</option>
            <option value="plain">Текстом (без уведомления)</option>
          </select>
        </div>
      </div>

      {/* === Детект отчёта === */}
      <SectionTitle>Детект отчёта в чате</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Маркеры отчёта (через запятую)</Label>
          <input className={input} value={(settings.report_marker_words || []).join(', ')}
            onChange={(e) => patch({ report_marker_words: e.target.value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) })} />
        </div>
        <div>
          <Label>Мин. меток метрик для детекта без маркера</Label>
          <input type="number" min={1} max={14} className={input} value={settings.min_label_matches_without_marker || 7}
            onChange={(e) => patch({ min_label_matches_without_marker: parseInt(e.target.value, 10) || 7 })} />
        </div>
      </div>

      {/* === Метки отсутствия === */}
      <SectionTitle>Метки отсутствия</SectionTitle>
      <p className="mb-3 text-xs text-slate-500">Слово → тип отсутствия (day_off, vacation, sick_leave). Ключ — слово, которое пишет риелтор.</p>
      <AbsenceEditor
        value={settings.absence_markers || {}}
        onChange={(v) => patch({ absence_markers: v })}
      />

      {/* === Метрики === */}
      <SectionTitle>Метрики отчёта</SectionTitle>
      <p className="mb-3 text-xs text-slate-500">
        Label — как написано в отчёте риелтора. Порядок влияет на сводку. Галочка "в сводке" — включать ли в утреннюю сводку в чат.
      </p>
      <MetricsEditor
        value={settings.metrics || []}
        onChange={(v) => patch({ metrics: v })}
      />

      {/* === Тексты сообщений === */}
      <SectionTitle>Тексты сообщений</SectionTitle>
      <p className="mb-3 text-xs text-slate-500">
        Переменные в фигурных скобках: {'{name}'}, {'{date}'}, {'{dates}'}, {'{value}'}, {'{users}'}, {'{open_at}'}, {'{close_at}'}, {'{max_days}'}, {'{actual_days}'}.
      </p>
      <div className="grid gap-3">
        {Object.entries(settings.messages || {}).map(([k, v]) => (
          <div key={k}>
            <Label>{k}</Label>
            <textarea rows={2} className={textarea} value={v} onChange={(e) => patchMsg(k, e.target.value)} />
          </div>
        ))}
      </div>

      <div className="mt-8 flex items-center justify-between border-t border-slate-800 pt-4">
        <span className="text-xs text-slate-500">
          Последнее обновление: {updatedAt ? new Date(updatedAt).toLocaleString('ru-RU') : '—'}
        </span>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>
    </AdminLayout>
  )
}

function AbsenceEditor({ value, onChange }) {
  const items = Object.entries(value)
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
      <div className="grid gap-2">
        {items.map(([word, type], i) => (
          <div key={i} className="flex items-center gap-2">
            <input className={input + ' flex-1'} value={word} placeholder="Слово"
              onChange={(e) => {
                const next = { ...value }
                delete next[word]
                next[e.target.value] = type
                onChange(next)
              }} />
            <select className={input + ' w-56'} value={type}
              onChange={(e) => onChange({ ...value, [word]: e.target.value })}>
              <option value="day_off">day_off (выходной)</option>
              <option value="vacation">vacation (отпуск)</option>
              <option value="sick_leave">sick_leave (больничный)</option>
            </select>
            <button className="rounded-lg px-2 py-2 text-xs text-red-400 hover:bg-red-500/10"
              onClick={() => { const next = { ...value }; delete next[word]; onChange(next) }}>✕</button>
          </div>
        ))}
        <button className="rounded-lg border border-dashed border-slate-700 px-3 py-2 text-xs text-slate-400 hover:bg-slate-800"
          onClick={() => onChange({ ...value, '': 'day_off' })}>
          + добавить метку
        </button>
      </div>
    </div>
  )
}

function MetricsEditor({ value, onChange }) {
  function updateIdx(i, partial) {
    const next = [...value]
    next[i] = { ...next[i], ...partial }
    onChange(next)
  }
  function move(i, delta) {
    const next = [...value]
    const j = i + delta
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    next.forEach((m, k) => (m.order = k + 1))
    onChange(next)
  }
  function remove(i) {
    const next = value.filter((_, k) => k !== i)
    next.forEach((m, k) => (m.order = k + 1))
    onChange(next)
  }
  function add() {
    onChange([
      ...value,
      { key: 'new_metric', label: 'Новая метрика', aliases: [], type: 'int', show_in_summary: false, order: value.length + 1 },
    ])
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
            <th className="w-8 px-2 py-2">#</th>
            <th className="px-2 py-2 text-left">Key</th>
            <th className="px-2 py-2 text-left">Label</th>
            <th className="px-2 py-2 text-left">Синонимы</th>
            <th className="px-2 py-2 text-left">Тип</th>
            <th className="px-2 py-2 text-center">В сводку</th>
            <th className="w-24 px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {value.map((m, i) => (
            <tr key={i} className="border-b border-slate-800/60">
              <td className="px-2 py-1 text-xs text-slate-500">{i + 1}</td>
              <td className="px-2 py-1">
                <input className={input} value={m.key || ''} onChange={(e) => updateIdx(i, { key: e.target.value })} />
              </td>
              <td className="px-2 py-1">
                <input className={input} value={m.label || ''} onChange={(e) => updateIdx(i, { label: e.target.value })} />
              </td>
              <td className="px-2 py-1">
                <input className={input} value={(m.aliases || []).join(', ')}
                  onChange={(e) => updateIdx(i, { aliases: e.target.value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) })} />
              </td>
              <td className="px-2 py-1">
                <select className={input} value={m.type || 'int'} onChange={(e) => updateIdx(i, { type: e.target.value })}>
                  <option value="int">int</option>
                  <option value="money">money (₽)</option>
                  <option value="shows">shows (N(M))</option>
                </select>
              </td>
              <td className="px-2 py-1 text-center">
                <input type="checkbox" checked={!!m.show_in_summary}
                  onChange={(e) => updateIdx(i, { show_in_summary: e.target.checked })} />
              </td>
              <td className="px-2 py-1">
                <div className="flex gap-1">
                  <button className="rounded px-1.5 py-1 text-xs text-slate-400 hover:bg-slate-800" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                  <button className="rounded px-1.5 py-1 text-xs text-slate-400 hover:bg-slate-800" onClick={() => move(i, 1)} disabled={i === value.length - 1}>↓</button>
                  <button className="rounded px-1.5 py-1 text-xs text-red-400 hover:bg-red-500/10" onClick={() => remove(i)}>✕</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-slate-800 p-2">
        <button onClick={add} className="rounded-lg border border-dashed border-slate-700 px-3 py-2 text-xs text-slate-400 hover:bg-slate-800">
          + добавить метрику
        </button>
      </div>
    </div>
  )
}
