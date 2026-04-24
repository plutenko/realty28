import { useEffect, useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/authContext'

const STATUS_LABEL = {
  new: 'Новый',
  add_to_base: 'Внести в базу',
  in_work: 'В работе',
  deal_done: 'Сделка',
  not_lead: 'Не лид',
  failed: 'Срыв',
}
const STATUS_COLOR = {
  new: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  add_to_base: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  in_work: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  deal_done: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  not_lead: 'bg-slate-600/30 text-slate-400 border-slate-600/40',
  failed: 'bg-red-500/20 text-red-300 border-red-500/30',
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

export default function AdminLeads() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [view, setView] = useState('kanban') // 'kanban' | 'list'
  const [filters, setFilters] = useState({ status: 'all', assigned: 'all', period: 'all', source_id: 'all' })
  const [sources, setSources] = useState([])
  const [realtors, setRealtors] = useState([])

  const [detail, setDetail] = useState(null) // selected lead for modal
  const [reassignFor, setReassignFor] = useState(null)
  const [reopenFor, setReopenFor] = useState(null)
  const [confirmInBaseFor, setConfirmInBaseFor] = useState(null)

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
    (async () => {
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
    } catch (e) {
      alert(e.message || e)
    }
  }

  async function changeStatus(lead, status, comment) {
    try {
      await apiFetch('POST', `/api/admin/leads/${lead.id}`, { action: 'change_status', status, comment })
      setDetail(null)
      await load()
    } catch (e) {
      alert(e.message || e)
    }
  }

  async function doReassign(lead, newUserId, comment) {
    try {
      await apiFetch('POST', `/api/admin/leads/${lead.id}`, { action: 'reassign', new_user_id: newUserId, comment })
      setReassignFor(null)
      setDetail(null)
      await load()
    } catch (e) {
      alert(e.message || e)
    }
  }

  async function doReopen(lead, newUserId, comment) {
    try {
      await apiFetch('POST', `/api/admin/leads/${lead.id}`, { action: 'reopen', new_user_id: newUserId, comment })
      setReopenFor(null)
      setDetail(null)
      await load()
    } catch (e) {
      alert(e.message || e)
    }
  }

  async function doConfirmInBase(lead, externalId) {
    try {
      await apiFetch('POST', `/api/admin/leads/${lead.id}`, { action: 'confirm_in_work', external_base_id: externalId })
      setConfirmInBaseFor(null)
      setDetail(null)
      await load()
    } catch (e) {
      alert(e.message || e)
    }
  }

  return (
    <AdminLayout title="Лиды">
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold text-white">Лиды</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setView('kanban')}
            className={`px-3 py-1.5 text-sm rounded-lg ${view === 'kanban' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            Канбан
          </button>
          <button
            onClick={() => setView('list')}
            className={`px-3 py-1.5 text-sm rounded-lg ${view === 'list' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            Список
          </button>
        </div>
      </div>

      {/* Фильтры */}
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={filters.period} onChange={e => setFilters(f => ({ ...f, period: e.target.value }))} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white">
          <option value="all">Всё время</option>
          <option value="today">Сегодня</option>
          <option value="week">7 дней</option>
          <option value="month">30 дней</option>
        </select>
        <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white">
          <option value="all">Все статусы</option>
          <option value="active">Активные</option>
          <option value="closed">Закрытые</option>
          {KANBAN_COLUMNS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={filters.assigned} onChange={e => setFilters(f => ({ ...f, assigned: e.target.value }))} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white">
          <option value="all">Все риелторы</option>
          <option value="none">Не назначен</option>
          {realtors.map(r => <option key={r.id} value={r.id}>{r.name || r.email}</option>)}
        </select>
        <select value={filters.source_id} onChange={e => setFilters(f => ({ ...f, source_id: e.target.value }))} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white">
          <option value="all">Все источники</option>
          {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 px-4 py-3 mb-4 text-sm">{err}</div>}

      {loading ? (
        <div className="text-slate-400 text-sm">Загрузка…</div>
      ) : leads.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-8 text-center text-slate-400">
          По фильтрам лидов нет.
        </div>
      ) : view === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {KANBAN_COLUMNS.map(st => (
            <div key={st} className="shrink-0 w-72 rounded-xl border border-slate-800 bg-slate-900/30">
              <div className={`flex items-center justify-between px-3 py-2 text-xs font-medium border-b border-slate-800 ${STATUS_COLOR[st]}`}>
                <span>{STATUS_LABEL[st]}</span>
                <span className="opacity-70">{byStatus[st]?.length || 0}</span>
              </div>
              <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto">
                {byStatus[st]?.length === 0 && (
                  <div className="text-center text-xs text-slate-600 py-4">пусто</div>
                )}
                {byStatus[st]?.map(l => (
                  <button
                    key={l.id}
                    onClick={() => setDetail(l)}
                    className="w-full text-left rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700 p-2 text-sm"
                  >
                    <div className="font-medium text-white truncate">{l.name || l.phone || '—'}</div>
                    {l.phone && <div className="text-xs text-slate-400 truncate">{l.phone}</div>}
                    <div className="text-xs text-slate-500 mt-1 flex items-center justify-between">
                      <span className="truncate">{l.lead_sources?.name || '—'}</span>
                      <span>{fmtDate(l.created_at)}</span>
                    </div>
                    {l.profiles?.name && (
                      <div className="text-xs text-emerald-400 mt-0.5 truncate">👤 {l.profiles.name}</div>
                    )}
                    {l.external_base_id && (
                      <div className="text-[10px] text-amber-300 mt-0.5 truncate">🔖 {l.external_base_id}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/70 text-slate-400 text-xs uppercase">
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
            <tbody className="divide-y divide-slate-800">
              {leads.map(l => (
                <tr key={l.id} onClick={() => setDetail(l)} className="cursor-pointer hover:bg-slate-900/40">
                  <td className="px-3 py-2 text-white">{l.name || '—'}</td>
                  <td className="px-3 py-2 text-slate-300">{l.phone || '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{l.lead_sources?.name || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs border ${STATUS_COLOR[l.status]}`}>
                      {STATUS_LABEL[l.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{l.profiles?.name || '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{fmtDate(l.created_at)}</td>
                  <td className="px-3 py-2 text-amber-300">{l.external_base_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <LeadDetailModal
          lead={detail}
          realtors={realtors}
          isAdmin={isAdmin}
          onClose={() => setDetail(null)}
          onDelete={() => handleDelete(detail)}
          onChangeStatus={(st, c) => changeStatus(detail, st, c)}
          onReassign={() => setReassignFor(detail)}
          onReopen={() => setReopenFor(detail)}
          onConfirmInBase={() => setConfirmInBaseFor(detail)}
        />
      )}
      {reassignFor && (
        <PickRealtorModal
          title="Переназначить лид"
          lead={reassignFor}
          realtors={realtors}
          onClose={() => setReassignFor(null)}
          onSubmit={(uid, c) => doReassign(reassignFor, uid, c)}
        />
      )}
      {reopenFor && (
        <PickRealtorModal
          title="Вернуть лид в работу"
          lead={reopenFor}
          realtors={realtors}
          onClose={() => setReopenFor(null)}
          onSubmit={(uid, c) => doReopen(reopenFor, uid, c)}
        />
      )}
      {confirmInBaseFor && (
        <ConfirmInBaseModal
          lead={confirmInBaseFor}
          onClose={() => setConfirmInBaseFor(null)}
          onSubmit={(id) => doConfirmInBase(confirmInBaseFor, id)}
        />
      )}
    </AdminLayout>
  )
}

function LeadDetailModal({ lead, realtors, isAdmin, onClose, onDelete, onChangeStatus, onReassign, onReopen, onConfirmInBase }) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const isTerminal = TERMINAL.includes(lead.status)

  async function wrap(fn) {
    if (busy) return
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-white">{lead.name || '—'}</h2>
            <div className="text-sm text-slate-400">{lead.phone || '—'}{lead.email ? ` · ${lead.email}` : ''}</div>
          </div>
          <button onClick={onClose} disabled={busy} className="text-slate-500 hover:text-white disabled:opacity-30">✕</button>
        </div>
        {busy && (
          <div className="mb-3 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
            ⌛ Обновляю…
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
          <Row label="Статус" value={<span className={`rounded px-2 py-0.5 text-xs border ${STATUS_COLOR[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>} />
          <Row label="Риелтор" value={lead.profiles?.name || lead.profiles?.email || '—'} />
          <Row label="Источник" value={lead.lead_sources?.name || '—'} />
          <Row label="Получен" value={fmtDate(lead.created_at)} />
          {typeof lead.reaction_seconds === 'number' && <Row label="Реакция" value={`${lead.reaction_seconds} сек`} />}
          {lead.external_base_id && <Row label="ID в базе" value={<span className="text-amber-300">{lead.external_base_id}</span>} />}
          {lead.close_reason && <Row label="Причина закрытия" value={lead.close_reason} />}
        </div>

        {Array.isArray(lead.answers) && lead.answers.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-slate-500 mb-1">Ответы квиза</div>
            <div className="space-y-1 text-sm text-slate-300">
              {lead.answers.map((a, i) => (
                <div key={i}>• <span className="text-slate-400">{a.question || a.q}:</span> {Array.isArray(a.answer || a.a) ? (a.answer || a.a).join(', ') : (a.answer || a.a)}</div>
              ))}
            </div>
          </div>
        )}

        {/* Действия */}
        <div className="flex flex-wrap gap-2 mb-4">
          {!isTerminal && (
            <>
              {lead.status === 'new' && <ActionBtn disabled={busy} color="blue" onClick={() => wrap(() => onChangeStatus('add_to_base'))}>Внести в базу</ActionBtn>}
              {lead.status === 'add_to_base' && <ActionBtn disabled={busy} color="emerald" onClick={() => wrap(onConfirmInBase)}>✅ Подтвердить: внесено</ActionBtn>}
              {lead.status === 'in_work' && <ActionBtn disabled={busy} color="violet" onClick={() => wrap(() => onChangeStatus('deal_done'))}>Сделка</ActionBtn>}

              <ActionBtn disabled={busy} color="slate" onClick={() => {
                const reason = prompt('Причина «не лид»:') || ''
                if (reason.trim()) wrap(() => onChangeStatus('not_lead', reason))
              }}>Не лид</ActionBtn>
              {lead.status === 'in_work' && <ActionBtn disabled={busy} color="red" onClick={() => {
                const reason = prompt('Причина срыва:') || ''
                if (reason.trim()) wrap(() => onChangeStatus('failed', reason))
              }}>Срыв</ActionBtn>}
              <ActionBtn disabled={busy} color="amber" onClick={() => wrap(onReassign)}>Переназначить</ActionBtn>
            </>
          )}
          {isTerminal && lead.status !== 'deal_done' && (
            <ActionBtn disabled={busy} color="emerald" onClick={() => wrap(onReopen)}>↩ Открыть заново</ActionBtn>
          )}
          {isAdmin && (
            <ActionBtn disabled={busy} color="red" onClick={() => wrap(onDelete)}>🗑 Удалить</ActionBtn>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-slate-200 mt-0.5">{value}</div>
    </div>
  )
}

function ActionBtn({ color = 'slate', children, onClick, disabled = false }) {
  const colors = {
    blue: 'bg-blue-600/30 hover:bg-blue-600/50 text-blue-200',
    emerald: 'bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200',
    violet: 'bg-violet-600/30 hover:bg-violet-600/50 text-violet-200',
    amber: 'bg-amber-500/30 hover:bg-amber-500/50 text-amber-200',
    red: 'bg-red-500/30 hover:bg-red-500/50 text-red-200',
    slate: 'bg-slate-700/60 hover:bg-slate-700 text-slate-200',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-sm rounded px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${colors[color] || colors.slate}`}
    >
      {children}
    </button>
  )
}

function PickRealtorModal({ title, lead, realtors, onClose, onSubmit }) {
  const [uid, setUid] = useState(lead?.assigned_user_id || '')
  const [comment, setComment] = useState('')
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-white mb-3">{title}</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400">Риелтор</label>
            <select
              value={uid}
              onChange={e => setUid(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            >
              <option value="">— выбрать —</option>
              {realtors.map(r => (
                <option key={r.id} value={r.id} disabled={!r.crm_enabled}>
                  {r.name || r.email}{!r.crm_enabled ? ' (CRM выключен)' : ''}{!r.has_telegram ? ' (нет TG)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Комментарий (необязательно)</label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800">Отмена</button>
          <button
            onClick={() => uid && onSubmit(uid, comment)}
            disabled={!uid}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm text-white font-medium"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmInBaseModal({ lead, onClose, onSubmit }) {
  const [id, setId] = useState('')
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-white mb-3">Подтвердить: внесено в базу</h3>
        <p className="text-xs text-slate-400 mb-3">
          Клиент: {lead.name || '—'} ({lead.phone || '—'}). Введи ID записи в базе агентства —
          риелтор получит уведомление и сможет работать дальше.
        </p>
        <input
          type="text"
          value={id}
          onChange={e => setId(e.target.value)}
          placeholder="ID в базе агентства"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800">Отмена</button>
          <button
            onClick={() => id.trim() && onSubmit(id.trim())}
            disabled={!id.trim()}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-sm text-white font-medium"
          >
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  )
}
