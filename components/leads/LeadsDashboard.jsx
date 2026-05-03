import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

const STATUS_LABEL = {
  new: 'Новый',
  add_to_base: 'Внести в базу',
  in_work: 'В работе',
  deal_done: 'Сделка',
  not_lead: 'Не лид',
  failed: 'Срыв',
}
const STATUS_COLOR_DARK = {
  new: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  add_to_base: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  in_work: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  deal_done: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  not_lead: 'bg-slate-600/30 text-slate-400 border-slate-600/40',
  failed: 'bg-red-500/20 text-red-300 border-red-500/30',
}
const STATUS_COLOR_LIGHT = {
  new: 'bg-blue-100 text-blue-700 border-blue-300',
  add_to_base: 'bg-amber-100 text-amber-700 border-amber-300',
  in_work: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  deal_done: 'bg-violet-100 text-violet-700 border-violet-300',
  not_lead: 'bg-gray-200 text-gray-700 border-gray-300',
  failed: 'bg-red-100 text-red-700 border-red-300',
}

const ACTIVE = ['new', 'add_to_base', 'in_work']
const TERMINAL = ['deal_done', 'not_lead', 'failed']
const KANBAN_COLUMNS = [...ACTIVE, ...TERMINAL]

async function apiFetch(method, path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  }
  if (body) opts.body = JSON.stringify(body)
  const r = await fetch(path, opts)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
  } catch { return iso }
}

const MESSENGER_LABELS = {
  max: 'Max', whatsapp: 'WhatsApp', telegram: 'Telegram', viber: 'Viber', signal: 'Signal',
}
function formatMessenger(key) {
  if (!key) return null
  const k = String(key).toLowerCase().trim()
  return MESSENGER_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1))
}

function formatReactionTime(sec) {
  const total = Math.max(0, Math.round(Number(sec) || 0))
  if (total < 60) return `${total} сек`
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    const parts = [`${h} ч`]
    if (m) parts.push(`${m} мин`)
    if (s) parts.push(`${s} сек`)
    return parts.join(' ')
  }
  return s ? `${m} мин ${s} сек` : `${m} мин`
}

/**
 * Общий дашборд лидов. Используется в /admin/leads (theme=dark) и /manager/leads (theme=light).
 * isAdmin=true — доступна кнопка «Удалить». Кнопки «Переназначить» и «Открыть заново»
 * доступны обеим ролям.
 */
export default function LeadsDashboard({ theme = 'dark', isAdmin = false }) {
  const STATUS_COLOR = theme === 'light' ? STATUS_COLOR_LIGHT : STATUS_COLOR_DARK
  const textPrimary = theme === 'light' ? 'text-gray-900' : 'text-white'
  const textSecondary = theme === 'light' ? 'text-gray-600' : 'text-slate-300'
  const textMuted = theme === 'light' ? 'text-gray-500' : 'text-slate-400'
  const bgSurface = theme === 'light' ? 'bg-white' : 'bg-slate-900/30'
  const bgInput = theme === 'light' ? 'bg-white' : 'bg-slate-800'
  const borderC = theme === 'light' ? 'border-gray-200' : 'border-slate-700'
  const tabIdle = theme === 'light' ? 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'

  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [view, setView] = useState('kanban')
  const [filters, setFilters] = useState({ status: 'all', assigned: 'all', period: 'all', source_id: 'all' })
  const [sources, setSources] = useState([])
  const [realtors, setRealtors] = useState([])

  const [detail, setDetail] = useState(null)
  const [reassignFor, setReassignFor] = useState(null)
  const [reopenFor, setReopenFor] = useState(null)
  const [confirmInBaseFor, setConfirmInBaseFor] = useState(null)
  const [dealModalFor, setDealModalFor] = useState(null)
  const [addOpen, setAddOpen] = useState(false)

  async function load() {
    setLoading(true)
    setErr('')
    try {
      const q = new URLSearchParams()
      if (filters.status !== 'all') q.set('status', filters.status)
      if (filters.assigned !== 'all') q.set('assigned', filters.assigned)
      if (filters.period !== 'all') q.set('period', filters.period)
      if (filters.source_id !== 'all') q.set('source_id', filters.source_id)
      const data = await apiFetch('GET', `/api/admin/leads?${q.toString()}`)
      setLeads(data)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filters])

  useEffect(() => {
    ;(async () => {
      try {
        const [s, u] = await Promise.all([
          apiFetch('GET', '/api/admin/lead-sources'),
          apiFetch('GET', '/api/admin/users'),
        ])
        setSources(s || [])
        setRealtors((u || []).filter(x => x.role === 'realtor' && x.is_active !== false))
      } catch {}
    })()
  }, [])

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(KANBAN_COLUMNS.map(s => [s, []]))
    for (const l of leads) if (map[l.status]) map[l.status].push(l)
    return map
  }, [leads])

  async function handleDelete(lead) {
    if (!isAdmin) return
    if (!confirm(`Удалить лид «${lead.name || lead.phone || lead.id}»? Восстановить нельзя.`)) return
    try {
      await apiFetch('DELETE', `/api/admin/leads/${lead.id}`)
      setDetail(null)
      await load()
    } catch (e) { alert(e.message || e) }
  }
  async function changeStatus(lead, status, comment, extra = {}) {
    try {
      await apiFetch('POST', `/api/admin/leads/${lead.id}`, {
        action: 'change_status',
        status,
        comment,
        ...extra,
      })
      setDetail(null)
      setDealModalFor(null)
      await load()
    } catch (e) { alert(e.message || e) }
  }
  async function doReassign(lead, newUserId, comment) {
    try {
      await apiFetch('POST', `/api/admin/leads/${lead.id}`, { action: 'reassign', new_user_id: newUserId, comment })
      setReassignFor(null); setDetail(null); await load()
    } catch (e) { alert(e.message || e) }
  }
  async function doReopen(lead, newUserId, comment) {
    try {
      await apiFetch('POST', `/api/admin/leads/${lead.id}`, { action: 'reopen', new_user_id: newUserId, comment })
      setReopenFor(null); setDetail(null); await load()
    } catch (e) { alert(e.message || e) }
  }
  async function doConfirmInBase(lead, payload) {
    try {
      await apiFetch('POST', `/api/admin/leads/${lead.id}`, {
        action: 'confirm_in_work',
        external_base_id_buyer: payload?.external_base_id_buyer ?? null,
        external_base_id_seller: payload?.external_base_id_seller ?? null,
      })
      setConfirmInBaseFor(null); setDetail(null); await load()
    } catch (e) { alert(e.message || e) }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <h1 className={`text-2xl font-semibold ${textPrimary}`}>Лиды</h1>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setAddOpen(true)}
            className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            ➕ Добавить лид
          </button>
          <button
            onClick={() => setView('kanban')}
            className={`px-3 py-1.5 text-sm rounded-lg ${view === 'kanban' ? 'bg-blue-600 text-white' : tabIdle}`}
          >
            Канбан
          </button>
          <button
            onClick={() => setView('list')}
            className={`px-3 py-1.5 text-sm rounded-lg ${view === 'list' ? 'bg-blue-600 text-white' : tabIdle}`}
          >
            Список
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <select value={filters.period} onChange={e => setFilters(f => ({ ...f, period: e.target.value }))} className={`rounded-lg border ${borderC} ${bgInput} px-3 py-1.5 text-sm ${textPrimary}`}>
          <option value="all">Всё время</option>
          <option value="today">Сегодня</option>
          <option value="week">7 дней</option>
          <option value="month">30 дней</option>
        </select>
        <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className={`rounded-lg border ${borderC} ${bgInput} px-3 py-1.5 text-sm ${textPrimary}`}>
          <option value="all">Все статусы</option>
          <option value="active">Активные</option>
          <option value="closed">Закрытые</option>
          {KANBAN_COLUMNS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={filters.assigned} onChange={e => setFilters(f => ({ ...f, assigned: e.target.value }))} className={`rounded-lg border ${borderC} ${bgInput} px-3 py-1.5 text-sm ${textPrimary}`}>
          <option value="all">Все риелторы</option>
          <option value="none">Не назначен</option>
          {realtors.map(r => <option key={r.id} value={r.id}>{r.name || r.email}</option>)}
        </select>
        <select value={filters.source_id} onChange={e => setFilters(f => ({ ...f, source_id: e.target.value }))} className={`rounded-lg border ${borderC} ${bgInput} px-3 py-1.5 text-sm ${textPrimary}`}>
          <option value="all">Все источники</option>
          {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 px-4 py-3 mb-4 text-sm">{err}</div>}

      {loading ? (
        <div className={`${textMuted} text-sm`}>Загрузка…</div>
      ) : leads.length === 0 ? (
        <div className={`rounded-xl border ${borderC} ${bgSurface} p-8 text-center ${textMuted}`}>По фильтрам лидов нет.</div>
      ) : view === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {KANBAN_COLUMNS.map(st => (
            <div key={st} className={`shrink-0 w-72 rounded-xl border ${borderC} ${bgSurface}`}>
              <div className={`flex items-center justify-between px-3 py-2 text-xs font-medium border-b ${borderC} ${STATUS_COLOR[st]}`}>
                <span>{STATUS_LABEL[st]}</span>
                <span className="opacity-70">{byStatus[st]?.length || 0}</span>
              </div>
              <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto">
                {byStatus[st]?.length === 0 && (
                  <div className={`text-center text-xs ${textMuted} py-4`}>пусто</div>
                )}
                {byStatus[st]?.map(l => (
                  <button
                    key={l.id}
                    onClick={() => setDetail(l)}
                    className={`w-full text-left rounded-lg border ${borderC} ${theme === 'light' ? 'bg-gray-50 hover:bg-gray-100' : 'bg-slate-800/60 hover:bg-slate-800'} p-2 text-sm`}
                  >
                    <div className={`font-medium ${textPrimary} truncate`}>{l.name || l.phone || '—'}</div>
                    {l.phone && <div className={`text-xs ${textMuted} truncate`}>{l.phone}</div>}
                    <div className={`text-xs ${textMuted} mt-1 flex items-center justify-between`}>
                      <span className="truncate">{l.lead_sources?.name || '—'}</span>
                      <span>{fmtDate(l.created_at)}</span>
                    </div>
                    {l.profiles?.name && (
                      <div className={`text-xs ${theme === 'light' ? 'text-emerald-700' : 'text-emerald-400'} mt-0.5 truncate`}>👤 {l.profiles.name}</div>
                    )}
                    {l.external_base_id && (
                      <div className={`text-[10px] ${theme === 'light' ? 'text-amber-700' : 'text-amber-300'} mt-0.5 truncate`}>🔖 {l.external_base_id}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`rounded-xl border ${borderC} overflow-hidden ${bgSurface}`}>
          <table className="w-full text-sm">
            <thead className={`${theme === 'light' ? 'bg-gray-50 text-gray-600' : 'bg-slate-900/70 text-slate-400'} text-xs uppercase`}>
              <tr>
                <th className="text-left px-3 py-2">Клиент</th>
                <th className="text-left px-3 py-2">Телефон</th>
                <th className="text-left px-3 py-2">Источник</th>
                <th className="text-left px-3 py-2">Статус</th>
                <th className="text-left px-3 py-2">Риелтор</th>
                <th className="text-left px-3 py-2">Дата</th>
                <th className="text-left px-3 py-2">ID в базе</th>
              </tr>
            </thead>
            <tbody className={theme === 'light' ? 'divide-y divide-gray-200' : 'divide-y divide-slate-800'}>
              {leads.map(l => (
                <tr key={l.id} onClick={() => setDetail(l)} className={`cursor-pointer ${theme === 'light' ? 'hover:bg-gray-50' : 'hover:bg-slate-900/40'}`}>
                  <td className={`px-3 py-2 ${textPrimary}`}>{l.name || '—'}</td>
                  <td className={`px-3 py-2 ${textSecondary}`}>{l.phone || '—'}</td>
                  <td className={`px-3 py-2 ${textMuted}`}>{l.lead_sources?.name || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs border ${STATUS_COLOR[l.status]}`}>{STATUS_LABEL[l.status]}</span>
                  </td>
                  <td className={`px-3 py-2 ${textSecondary}`}>{l.profiles?.name || '—'}</td>
                  <td className={`px-3 py-2 ${textMuted}`}>{fmtDate(l.created_at)}</td>
                  <td className={`px-3 py-2 ${theme === 'light' ? 'text-amber-700' : 'text-amber-300'}`}>{l.external_base_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <LeadDetailModal
          theme={theme}
          lead={detail}
          isAdmin={isAdmin}
          statusColor={STATUS_COLOR}
          onClose={() => setDetail(null)}
          onDelete={() => handleDelete(detail)}
          onChangeStatus={(st, c) => changeStatus(detail, st, c)}
          onCloseDeal={() => setDealModalFor(detail)}
          onReassign={() => setReassignFor(detail)}
          onReopen={() => setReopenFor(detail)}
          onConfirmInBase={() => setConfirmInBaseFor(detail)}
        />
      )}
      {reassignFor && (
        <PickRealtorModal theme={theme} title="Переназначить лид" realtors={realtors} onClose={() => setReassignFor(null)} onSubmit={(uid, c) => doReassign(reassignFor, uid, c)} />
      )}
      {reopenFor && (
        <PickRealtorModal theme={theme} title="Вернуть лид в работу" realtors={realtors} onClose={() => setReopenFor(null)} onSubmit={(uid, c) => doReopen(reopenFor, uid, c)} />
      )}
      {confirmInBaseFor && (
        <ConfirmInBaseModal theme={theme} lead={confirmInBaseFor} onClose={() => setConfirmInBaseFor(null)} onSubmit={(id) => doConfirmInBase(confirmInBaseFor, id)} />
      )}
      {dealModalFor && (
        <DealRevenueModal theme={theme} lead={dealModalFor} onClose={() => setDealModalFor(null)} onSubmit={(rub, comment) => changeStatus(dealModalFor, 'deal_done', comment, { deal_revenue_rub: rub })} />
      )}
      {addOpen && (
        <AddLeadModal
          theme={theme}
          sources={sources}
          realtors={realtors}
          onClose={() => setAddOpen(false)}
          onCreated={async () => { setAddOpen(false); await load() }}
        />
      )}
    </>
  )
}

function AddLeadModal({ theme, sources, realtors, onClose, onCreated }) {
  const dark = theme !== 'light'
  const activeSources = (sources || []).filter(s => s.is_active)
  const [form, setForm] = useState({
    source_id: activeSources[0]?.id || '',
    name: '',
    phone: '',
    email: '',
    rooms: '',
    budget: '',
    comment: '',
    assigned_user_id: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!form.source_id) { setErr('Выбери источник'); return }
    if (!form.name.trim() && !form.phone.trim()) { setErr('Нужно имя или телефон'); return }
    setBusy(true); setErr('')
    try {
      const body = {
        source_id: form.source_id,
        name: form.name.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        rooms: form.rooms.trim() || null,
        budget: form.budget.trim() || null,
        comment: form.comment.trim() || null,
        assigned_user_id: form.assigned_user_id || null,
      }
      await apiFetch('POST', '/api/admin/leads/create', body)
      await onCreated()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className={`rounded-xl w-full max-w-lg p-6 ${dark ? 'bg-slate-900 border border-slate-700' : 'bg-white shadow-xl'}`} onClick={e => e.stopPropagation()}>
        <h3 className={`text-lg font-semibold mb-3 ${dark ? 'text-white' : 'text-gray-900'}`}>Добавить лид вручную</h3>
        <p className={`text-xs mb-4 ${dark ? 'text-slate-400' : 'text-gray-500'}`}>
          Для лидов со звонков, встреч, рекомендаций и других источников вне квизов.
        </p>

        <div className="space-y-3">
          <Field theme={theme} label="Источник">
            <select value={form.source_id} onChange={e => setForm(f => ({ ...f, source_id: e.target.value }))} className={inputCls(dark)}>
              {activeSources.length === 0 && <option value="">— нет источников —</option>}
              {activeSources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field theme={theme} label="Имя клиента">
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls(dark)} />
            </Field>
            <Field theme={theme} label="Телефон">
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+7..." className={inputCls(dark)} />
            </Field>
          </div>

          <Field theme={theme} label="Email (необязательно)">
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls(dark)} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field theme={theme} label="Комнат">
              <input type="text" value={form.rooms} onChange={e => setForm(f => ({ ...f, rooms: e.target.value }))} placeholder="напр. 2" className={inputCls(dark)} />
            </Field>
            <Field theme={theme} label="Бюджет">
              <input type="text" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} placeholder="напр. 3–5 млн" className={inputCls(dark)} />
            </Field>
          </div>

          <Field theme={theme} label="Назначить сразу (необязательно)">
            <select value={form.assigned_user_id} onChange={e => setForm(f => ({ ...f, assigned_user_id: e.target.value }))} className={inputCls(dark)}>
              <option value="">— рассылка всем CRM-риелторам —</option>
              {realtors.map(r => (
                <option key={r.id} value={r.id} disabled={!r.crm_enabled || !r.has_telegram}>
                  {r.name || r.email}{!r.crm_enabled ? ' (CRM выкл.)' : ''}{!r.has_telegram ? ' (нет TG)' : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field theme={theme} label="Комментарий (необязательно)">
            <textarea rows={2} value={form.comment} onChange={e => setForm(f => ({ ...f, comment: e.target.value }))} className={inputCls(dark)} />
          </Field>
        </div>

        {err && <p className={`mt-3 text-sm ${dark ? 'text-red-300' : 'text-red-600'}`}>{err}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={busy} className={`rounded-lg px-3 py-2 text-sm ${dark ? 'text-slate-400 hover:bg-slate-800' : 'text-gray-500 hover:bg-gray-100'}`}>Отмена</button>
          <button onClick={submit} disabled={busy} className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-sm text-white font-medium">
            {busy ? 'Создаю…' : 'Добавить лид'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ theme, label, children }) {
  const dark = theme !== 'light'
  return (
    <label className="block">
      <div className={`text-xs mb-1 ${dark ? 'text-slate-400' : 'text-gray-500'}`}>{label}</div>
      {children}
    </label>
  )
}

function inputCls(dark) {
  return `w-full rounded-lg border px-3 py-2 text-sm ${dark ? 'border-slate-700 bg-slate-800 text-white' : 'border-gray-200 bg-white text-gray-900'}`
}

function LeadDetailModal({ theme, lead, isAdmin, statusColor, onClose, onDelete, onChangeStatus, onCloseDeal, onReassign, onReopen, onConfirmInBase }) {
  const [busy, setBusy] = useState(false)
  const isTerminal = TERMINAL.includes(lead.status)
  const dark = theme !== 'light'

  async function wrap(fn) {
    if (busy) return
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className={`rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 ${dark ? 'bg-slate-900 border border-slate-700' : 'bg-white shadow-xl'}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className={`text-xl font-semibold ${dark ? 'text-white' : 'text-gray-900'}`}>{lead.name || '—'}</h2>
            <div className={`text-sm ${dark ? 'text-slate-400' : 'text-gray-600'}`}>{lead.phone || '—'}{lead.email ? ` · ${lead.email}` : ''}</div>
          </div>
          <button onClick={onClose} disabled={busy} className={`${dark ? 'text-slate-500 hover:text-white' : 'text-gray-400 hover:text-gray-700'} disabled:opacity-30`}>✕</button>
        </div>
        {busy && (
          <div className={`mb-3 rounded-lg border px-3 py-2 text-sm ${dark ? 'border-blue-500/40 bg-blue-500/10 text-blue-200' : 'border-blue-300 bg-blue-50 text-blue-700'}`}>⌛ Обновляю…</div>
        )}
        <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
          <Row theme={theme} label="Статус" value={<span className={`rounded px-2 py-0.5 text-xs border ${statusColor[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>} />
          <Row theme={theme} label="Риелтор" value={lead.profiles?.name || lead.profiles?.email || '—'} />
          <Row theme={theme} label="Источник" value={lead.lead_sources?.name || '—'} />
          <Row theme={theme} label="Получен" value={fmtDate(lead.created_at)} />
          {lead.messenger && <Row theme={theme} label="Мессенджер" value={formatMessenger(lead.messenger)} />}
          {typeof lead.reaction_seconds === 'number' && <Row theme={theme} label="Реакция" value={formatReactionTime(lead.reaction_seconds)} />}
          {lead.lead_kind && <Row theme={theme} label="Категория" value={({ buyer: '🏠 Покупатель', seller: '🔑 Продавец', both: '🔄 Покупатель и Продавец' })[lead.lead_kind] || lead.lead_kind} />}
          {lead.external_base_id && (
            <Row
              theme={theme}
              label={lead.lead_kind === 'both' ? 'ID покупателя' : 'ID в базе'}
              value={<span className={dark ? 'text-amber-300' : 'text-amber-700'}>{lead.external_base_id}</span>}
            />
          )}
          {lead.external_base_id_seller && (
            <Row
              theme={theme}
              label="ID продавца"
              value={<span className={dark ? 'text-amber-300' : 'text-amber-700'}>{lead.external_base_id_seller}</span>}
            />
          )}
          {lead.close_reason && <Row theme={theme} label="Причина закрытия" value={lead.close_reason} />}
        </div>
        {Array.isArray(lead.answers) && lead.answers.length > 0 && (
          <div className="mb-4">
            <div className={`text-xs ${dark ? 'text-slate-500' : 'text-gray-500'} mb-1`}>Ответы квиза</div>
            <div className={`space-y-1 text-sm ${dark ? 'text-slate-300' : 'text-gray-700'}`}>
              {lead.answers.map((a, i) => (
                <div key={i}>• <span className={dark ? 'text-slate-400' : 'text-gray-500'}>{a.question || a.q}:</span> {Array.isArray(a.answer || a.a) ? (a.answer || a.a).join(', ') : (a.answer || a.a)}</div>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2 mb-4">
          {!isTerminal && (
            <>
              {lead.status === 'new' && <ActionBtn dark={dark} disabled={busy} color="blue" onClick={() => wrap(() => onChangeStatus('add_to_base'))}>Внести в базу</ActionBtn>}
              {lead.status === 'add_to_base' && <ActionBtn dark={dark} disabled={busy} color="emerald" onClick={() => wrap(onConfirmInBase)}>✅ Подтвердить: внесено</ActionBtn>}
              {lead.status === 'in_work' && <ActionBtn dark={dark} disabled={busy} color="violet" onClick={() => wrap(onCloseDeal)}>Сделка</ActionBtn>}
              <ActionBtn dark={dark} disabled={busy} color="slate" onClick={() => {
                const reason = prompt('Причина «не лид»:') || ''
                if (reason.trim()) wrap(() => onChangeStatus('not_lead', reason))
              }}>Не лид</ActionBtn>
              {lead.status === 'in_work' && <ActionBtn dark={dark} disabled={busy} color="red" onClick={() => {
                const reason = prompt('Причина срыва:') || ''
                if (reason.trim()) wrap(() => onChangeStatus('failed', reason))
              }}>Срыв</ActionBtn>}
              <ActionBtn dark={dark} disabled={busy} color="amber" onClick={() => wrap(onReassign)}>Переназначить</ActionBtn>
            </>
          )}
          {isTerminal && lead.status !== 'deal_done' && (
            <ActionBtn dark={dark} disabled={busy} color="emerald" onClick={() => wrap(onReopen)}>↩ Открыть заново</ActionBtn>
          )}
          {isAdmin && (
            <ActionBtn dark={dark} disabled={busy} color="red" onClick={() => wrap(onDelete)}>🗑 Удалить</ActionBtn>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ theme, label, value }) {
  const dark = theme !== 'light'
  return (
    <div>
      <div className={`text-xs ${dark ? 'text-slate-500' : 'text-gray-500'}`}>{label}</div>
      <div className={`mt-0.5 ${dark ? 'text-slate-200' : 'text-gray-900'}`}>{value}</div>
    </div>
  )
}

function ActionBtn({ color = 'slate', children, onClick, disabled = false, dark = true }) {
  const darkColors = {
    blue: 'bg-blue-600/30 hover:bg-blue-600/50 text-blue-200',
    emerald: 'bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200',
    violet: 'bg-violet-600/30 hover:bg-violet-600/50 text-violet-200',
    amber: 'bg-amber-500/30 hover:bg-amber-500/50 text-amber-200',
    red: 'bg-red-500/30 hover:bg-red-500/50 text-red-200',
    slate: 'bg-slate-700/60 hover:bg-slate-700 text-slate-200',
  }
  const lightColors = {
    blue: 'bg-blue-600 hover:bg-blue-500 text-white',
    emerald: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    violet: 'bg-violet-600 hover:bg-violet-500 text-white',
    amber: 'bg-amber-500 hover:bg-amber-400 text-white',
    red: 'bg-red-500 hover:bg-red-400 text-white',
    slate: 'bg-gray-600 hover:bg-gray-500 text-white',
  }
  const c = dark ? darkColors : lightColors
  return (
    <button onClick={onClick} disabled={disabled} className={`text-sm rounded px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${c[color] || c.slate}`}>{children}</button>
  )
}

function PickRealtorModal({ theme, title, realtors, onClose, onSubmit }) {
  const [uid, setUid] = useState('')
  const [comment, setComment] = useState('')
  const dark = theme !== 'light'
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-xl w-full max-w-md p-6 ${dark ? 'bg-slate-900 border border-slate-700' : 'bg-white shadow-xl'}`} onClick={e => e.stopPropagation()}>
        <h3 className={`text-lg font-semibold mb-3 ${dark ? 'text-white' : 'text-gray-900'}`}>{title}</h3>
        <div className="space-y-3">
          <div>
            <label className={`text-xs ${dark ? 'text-slate-400' : 'text-gray-500'}`}>Риелтор</label>
            <select value={uid} onChange={e => setUid(e.target.value)} className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${dark ? 'border-slate-700 bg-slate-800 text-white' : 'border-gray-200 bg-white text-gray-900'}`}>
              <option value="">— выбрать —</option>
              {realtors.map(r => (
                <option key={r.id} value={r.id} disabled={!r.crm_enabled}>
                  {r.name || r.email}{!r.crm_enabled ? ' (CRM выключен)' : ''}{!r.has_telegram ? ' (нет TG)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={`text-xs ${dark ? 'text-slate-400' : 'text-gray-500'}`}>Комментарий (необязательно)</label>
            <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${dark ? 'border-slate-700 bg-slate-800 text-white' : 'border-gray-200 bg-white text-gray-900'}`} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className={`rounded-lg px-3 py-2 text-sm ${dark ? 'text-slate-400 hover:bg-slate-800' : 'text-gray-500 hover:bg-gray-100'}`}>Отмена</button>
          <button onClick={() => uid && onSubmit(uid, comment)} disabled={!uid} className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm text-white font-medium">Сохранить</button>
        </div>
      </div>
    </div>
  )
}

function ConfirmInBaseModal({ theme, lead, onClose, onSubmit }) {
  const dark = theme !== 'light'
  const isBoth = lead.lead_kind === 'both'
  const [buyer, setBuyer] = useState('')
  const [seller, setSeller] = useState('')
  const kindLabel = ({ buyer: 'Покупатель', seller: 'Продавец', both: 'Покупатель и Продавец' })[lead.lead_kind || ''] || '—'

  const ready = isBoth ? buyer.trim() && seller.trim() : buyer.trim()
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm ${dark ? 'border-slate-700 bg-slate-800 text-white' : 'border-gray-200 bg-white text-gray-900'}`

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-xl w-full max-w-md p-6 ${dark ? 'bg-slate-900 border border-slate-700' : 'bg-white shadow-xl'}`} onClick={e => e.stopPropagation()}>
        <h3 className={`text-lg font-semibold mb-3 ${dark ? 'text-white' : 'text-gray-900'}`}>Подтвердить: внесено в базу</h3>
        <p className={`text-xs mb-3 ${dark ? 'text-slate-400' : 'text-gray-600'}`}>
          Клиент: {lead.name || '—'} ({lead.phone || '—'}). Категория: <b>{kindLabel}</b>.
          {isBoth ? ' Нужны два ID — продавца и покупателя.' : ' Введи ID записи в базе агентства.'}
        </p>
        {isBoth ? (
          <div className="space-y-3">
            <label className="block">
              <div className={`text-xs mb-1 ${dark ? 'text-slate-400' : 'text-gray-500'}`}>ID покупателя</div>
              <input type="text" value={buyer} onChange={e => setBuyer(e.target.value)} placeholder="например, BUY-1234" autoFocus className={inputCls} />
            </label>
            <label className="block">
              <div className={`text-xs mb-1 ${dark ? 'text-slate-400' : 'text-gray-500'}`}>ID продавца</div>
              <input type="text" value={seller} onChange={e => setSeller(e.target.value)} placeholder="например, SELL-5678" className={inputCls} />
            </label>
          </div>
        ) : (
          <input type="text" value={buyer} onChange={e => setBuyer(e.target.value)} placeholder="ID в базе агентства" autoFocus className={inputCls} />
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className={`rounded-lg px-3 py-2 text-sm ${dark ? 'text-slate-400 hover:bg-slate-800' : 'text-gray-500 hover:bg-gray-100'}`}>Отмена</button>
          <button
            onClick={() => ready && onSubmit({
              external_base_id_buyer: buyer.trim(),
              external_base_id_seller: isBoth ? seller.trim() : null,
            })}
            disabled={!ready}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-sm text-white font-medium"
          >
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  )
}

function DealRevenueModal({ theme, lead, onClose, onSubmit }) {
  const dark = theme !== 'light'
  const [revenue, setRevenue] = useState('')
  const [comment, setComment] = useState('')

  const num = Number(String(revenue).replace(/\s+/g, '').replace(',', '.'))
  const ready = Number.isFinite(num) && num > 0

  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm ${dark ? 'border-slate-700 bg-slate-800 text-white' : 'border-gray-200 bg-white text-gray-900'}`

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-xl w-full max-w-md p-6 ${dark ? 'bg-slate-900 border border-slate-700' : 'bg-white shadow-xl'}`} onClick={e => e.stopPropagation()}>
        <h3 className={`text-lg font-semibold mb-1 ${dark ? 'text-white' : 'text-gray-900'}`}>Закрыть сделку</h3>
        <p className={`text-xs mb-4 ${dark ? 'text-slate-400' : 'text-gray-600'}`}>
          Клиент: <b>{lead.name || '—'}</b> ({lead.phone || '—'}).
        </p>
        <label className="block mb-3">
          <div className={`text-xs mb-1 ${dark ? 'text-slate-300' : 'text-gray-600'}`}>
            Вал — комиссия риелтора с продажи (₽) <span className="text-red-400">*</span>
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={revenue}
            onChange={e => setRevenue(e.target.value)}
            placeholder="например, 150000"
            autoFocus
            className={inputCls}
          />
          {revenue && !ready && (
            <div className="mt-1 text-xs text-red-400">Введите положительное число</div>
          )}
        </label>
        <label className="block">
          <div className={`text-xs mb-1 ${dark ? 'text-slate-400' : 'text-gray-500'}`}>Комментарий (необязательно)</div>
          <input
            type="text"
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="детали сделки, контакт"
            className={inputCls}
          />
        </label>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className={`rounded-lg px-3 py-2 text-sm ${dark ? 'text-slate-400 hover:bg-slate-800' : 'text-gray-500 hover:bg-gray-100'}`}>Отмена</button>
          <button
            onClick={() => ready && onSubmit(num, comment.trim() || null)}
            disabled={!ready}
            className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 px-4 py-2 text-sm text-white font-medium"
          >
            Закрыть сделку
          </button>
        </div>
      </div>
    </div>
  )
}
