import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import CatalogTabs from '../components/CatalogTabs'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/authContext'

const STATUS_LABEL = {
  new: 'Новый',
  add_to_base: 'Внести в базу',
  in_work: 'В работе',
  deal_done: 'Сделка',
  not_lead: 'Не лид',
  failed: 'Срыв',
}
const STATUS_COLOR = {
  new: 'bg-blue-500/20 text-blue-700 border-blue-300',
  add_to_base: 'bg-amber-500/20 text-amber-700 border-amber-300',
  in_work: 'bg-emerald-500/20 text-emerald-700 border-emerald-300',
  deal_done: 'bg-violet-500/20 text-violet-700 border-violet-300',
  not_lead: 'bg-slate-400/30 text-slate-700 border-slate-400',
  failed: 'bg-red-500/20 text-red-700 border-red-300',
}
const KANBAN_COLUMNS = ['new', 'add_to_base', 'in_work', 'deal_done', 'not_lead', 'failed']
const TERMINAL = ['deal_done', 'not_lead', 'failed']

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

export default function CrmPage() {
  const router = useRouter()
  const { user, profile, loading: authLoading } = useAuth()

  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [view, setView] = useState('kanban')
  const [filters, setFilters] = useState({ status: 'all', period: 'all' })
  const [detail, setDetail] = useState(null)
  const [kindFor, setKindFor] = useState(null) // лид, для которого выбираем категорию (Внести в базу)

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.replace('/login'); return }
    if (profile && !profile.crm_enabled) { router.replace('/apartments'); return }
  }, [authLoading, user, profile, router])

  async function load() {
    setLoading(true)
    setErr('')
    try {
      const q = new URLSearchParams()
      if (filters.status !== 'all') q.set('status', filters.status)
      if (filters.period !== 'all') q.set('period', filters.period)
      const data = await apiFetch('GET', `/api/crm/leads?${q.toString()}`)
      setLeads(data)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (user && profile?.crm_enabled) load() }, [filters, user, profile])

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(KANBAN_COLUMNS.map(s => [s, []]))
    for (const l of leads) if (map[l.status]) map[l.status].push(l)
    return map
  }, [leads])

  async function changeStatus(lead, status, commentArg, leadKind) {
    let comment = commentArg
    if ((status === 'not_lead' || status === 'failed') && !comment) {
      comment = prompt(status === 'not_lead' ? 'Причина «не лид»:' : 'Причина срыва:')
      if (!comment || !comment.trim()) return
    }
    if (status === 'add_to_base' && !leadKind) {
      // Открываем модалку выбора категории
      setKindFor(lead)
      return
    }
    try {
      const body = { action: 'change_status', status, comment }
      if (leadKind) body.lead_kind = leadKind
      await apiFetch('POST', `/api/crm/leads/${lead.id}`, body)
      setDetail(null)
      setKindFor(null)
      await load()
    } catch (e) {
      alert(e.message || e)
    }
  }

  if (authLoading || !user) {
    return <div className="p-6 text-sm text-gray-500">Загрузка…</div>
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <CatalogTabs />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold text-gray-900">Мои лиды</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setView('kanban')}
              className={`px-3 py-1.5 text-sm rounded-lg ${view === 'kanban' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'}`}
            >
              Канбан
            </button>
            <button
              onClick={() => setView('list')}
              className={`px-3 py-1.5 text-sm rounded-lg ${view === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'}`}
            >
              Список
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <select value={filters.period} onChange={e => setFilters(f => ({ ...f, period: e.target.value }))} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm">
            <option value="all">Всё время</option>
            <option value="today">Сегодня</option>
            <option value="week">7 дней</option>
            <option value="month">30 дней</option>
          </select>
          <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm">
            <option value="all">Все статусы</option>
            <option value="active">Активные</option>
            <option value="closed">Закрытые</option>
            {KANBAN_COLUMNS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>

        {err && <div className="rounded-lg border border-red-300 bg-red-50 text-red-800 px-4 py-3 mb-4 text-sm">{err}</div>}

        {loading ? (
          <div className="text-gray-500 text-sm">Загрузка…</div>
        ) : leads.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
            У вас пока нет лидов. Когда кто-то из клиентов оставит заявку и вы нажмёте «Беру» в Домовое-боте, они появятся здесь.
          </div>
        ) : view === 'kanban' ? (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {KANBAN_COLUMNS.map(st => (
              <div key={st} className="shrink-0 w-72 rounded-xl border border-gray-200 bg-white">
                <div className={`flex items-center justify-between px-3 py-2 text-xs font-medium border-b ${STATUS_COLOR[st]}`}>
                  <span>{STATUS_LABEL[st]}</span>
                  <span className="opacity-70">{byStatus[st]?.length || 0}</span>
                </div>
                <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto">
                  {byStatus[st]?.length === 0 && (
                    <div className="text-center text-xs text-gray-400 py-4">пусто</div>
                  )}
                  {byStatus[st]?.map(l => (
                    <button
                      key={l.id}
                      onClick={() => setDetail(l)}
                      className="w-full text-left rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 p-2 text-sm"
                    >
                      <div className="font-medium text-gray-900 truncate">{l.name || l.phone || '—'}</div>
                      {l.phone && <div className="text-xs text-gray-600 truncate">{l.phone}</div>}
                      <div className="text-xs text-gray-500 mt-1">{fmtDate(l.created_at)}</div>
                      {l.external_base_id && (
                        <div className="text-[10px] text-amber-700 mt-0.5 truncate">🔖 {l.external_base_id}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Клиент</th>
                  <th className="text-left px-3 py-2">Телефон</th>
                  <th className="text-left px-3 py-2">Статус</th>
                  <th className="text-left px-3 py-2">Дата</th>
                  <th className="text-left px-3 py-2">ID в базе</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {leads.map(l => (
                  <tr key={l.id} onClick={() => setDetail(l)} className="cursor-pointer hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-900">{l.name || '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{l.phone || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs border ${STATUS_COLOR[l.status]}`}>
                        {STATUS_LABEL[l.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{fmtDate(l.created_at)}</td>
                    <td className="px-3 py-2 text-amber-700">{l.external_base_id || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {detail && (
          <LeadDetailModal
            lead={detail}
            onClose={() => setDetail(null)}
            onChangeStatus={(st, c) => changeStatus(detail, st, c)}
          />
        )}
        {kindFor && (
          <KindPickerModal
            lead={kindFor}
            onClose={() => setKindFor(null)}
            onSubmit={(kind) => changeStatus(kindFor, 'add_to_base', null, kind)}
          />
        )}
      </div>
    </div>
  )
}

function LeadDetailModal({ lead, onClose, onChangeStatus }) {
  const [busy, setBusy] = useState(false)
  const isTerminal = TERMINAL.includes(lead.status)

  async function wrap(fn) {
    if (busy) return
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{lead.name || '—'}</h2>
            <div className="text-sm text-gray-600">{lead.phone || '—'}{lead.email ? ` · ${lead.email}` : ''}</div>
          </div>
          <button onClick={onClose} disabled={busy} className="text-gray-400 hover:text-gray-700 disabled:opacity-40">✕</button>
        </div>

        {busy && (
          <div className="mb-3 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-700">
            ⌛ Обновляю…
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
          <Row label="Статус" value={
            <span className={`rounded px-2 py-0.5 text-xs border ${STATUS_COLOR[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>
          } />
          <Row label="Получен" value={fmtDate(lead.created_at)} />
          {lead.external_base_id && <Row label="ID в базе" value={<span className="text-amber-700 font-medium">{lead.external_base_id}</span>} />}
          {lead.close_reason && <Row label="Причина закрытия" value={lead.close_reason} />}
        </div>

        {Array.isArray(lead.answers) && lead.answers.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-gray-500 mb-1">Ответы квиза</div>
            <div className="space-y-1 text-sm text-gray-700">
              {lead.answers.map((a, i) => (
                <div key={i}>• <span className="text-gray-500">{a.question || a.q}:</span> {Array.isArray(a.answer || a.a) ? (a.answer || a.a).join(', ') : (a.answer || a.a)}</div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-2">
          {!isTerminal && (
            <>
              {lead.status === 'new' && (
                <>
                  <ActionBtn disabled={busy} color="blue" onClick={() => wrap(() => onChangeStatus('add_to_base'))}>Внести в базу</ActionBtn>
                  <ActionBtn disabled={busy} color="slate" onClick={() => wrap(() => onChangeStatus('not_lead'))}>Не лид</ActionBtn>
                </>
              )}
              {lead.status === 'add_to_base' && (
                <div className="text-sm text-amber-700 w-full">
                  ⏳ Ждём подтверждения от руководителя, что лид внесён в базу агентства.
                </div>
              )}
              {lead.status === 'in_work' && (
                <>
                  <ActionBtn disabled={busy} color="violet" onClick={() => wrap(() => onChangeStatus('deal_done'))}>Сделка</ActionBtn>
                  <ActionBtn disabled={busy} color="red" onClick={() => wrap(() => onChangeStatus('failed'))}>Срыв</ActionBtn>
                </>
              )}
            </>
          )}
          {isTerminal && (
            <div className="text-sm text-gray-500 w-full">Лид закрыт. Если это ошибка — сообщите руководителю.</div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-gray-900 mt-0.5">{value}</div>
    </div>
  )
}

function KindPickerModal({ lead, onClose, onSubmit }) {
  const [kind, setKind] = useState('buyer')
  const [busy, setBusy] = useState(false)
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Категория клиента</h3>
        <p className="text-sm text-gray-600 mb-4">
          Клиент {lead.name || ''} — выбери, что он хочет, чтобы админ внёс правильную запись в базу агентства.
        </p>
        <div className="space-y-2">
          {[
            ['buyer', '🏠 Покупатель', 'Хочет купить квартиру'],
            ['seller', '🔑 Продавец', 'Хочет продать квартиру'],
            ['both', '🔄 Покупатель и Продавец', 'Продаёт свою и покупает новую — нужны 2 записи в базе'],
          ].map(([v, label, hint]) => (
            <label key={v} className={`flex items-start gap-3 cursor-pointer rounded-lg border p-3 ${kind === v ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:bg-gray-50'}`}>
              <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} className="mt-1" />
              <div>
                <div className="text-sm font-medium text-gray-900">{label}</div>
                <div className="text-xs text-gray-500">{hint}</div>
              </div>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100">Отмена</button>
          <button
            onClick={async () => { setBusy(true); try { await onSubmit(kind) } finally { setBusy(false) } }}
            disabled={busy}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm text-white font-medium"
          >
            {busy ? 'Отправляю…' : 'Внести в базу'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ActionBtn({ color = 'slate', children, onClick, disabled = false }) {
  const colors = {
    blue: 'bg-blue-600 hover:bg-blue-500 text-white',
    emerald: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    violet: 'bg-violet-600 hover:bg-violet-500 text-white',
    amber: 'bg-amber-500 hover:bg-amber-400 text-white',
    red: 'bg-red-500 hover:bg-red-400 text-white',
    slate: 'bg-gray-600 hover:bg-gray-500 text-white',
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
