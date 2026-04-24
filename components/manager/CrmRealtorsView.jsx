import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

async function apiFetch(path) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, { headers: { Authorization: `Bearer ${session?.access_token}` } })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Ошибка')
  return json
}

export default function CrmRealtorsView() {
  const [realtors, setRealtors] = useState([])
  const [counts, setCounts] = useState({})
  const [settings, setSettings] = useState({ limits_enabled: false, limit_threshold: 10, unclaimed_escalation_minutes: 40 })
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [savingSettings, setSavingSettings] = useState(false)

  async function load() {
    setLoading(true)
    setErr('')
    try {
      const [rs, cs, st] = await Promise.all([
        apiFetch('/api/manager/crm-realtors'),
        apiFetch('/api/manager/crm-realtor-counts'),
        apiFetch('/api/manager/crm-settings'),
      ])
      setRealtors(rs || [])
      const map = {}
      for (const c of cs || []) map[c.id] = c
      setCounts(map)
      setSettings(st || { limits_enabled: false, limit_threshold: 10, unclaimed_escalation_minutes: 40 })
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function saveSettings(patch) {
    setSavingSettings(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/manager/crm-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify(patch),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Ошибка')
      setSettings(s => ({ ...s, ...patch }))
    } catch (e) {
      alert(e.message || e)
    } finally {
      setSavingSettings(false)
    }
  }

  async function toggle(r) {
    setBusyId(r.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/manager/crm-realtors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ id: r.id, crm_enabled: !r.crm_enabled }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка')

      if (!r.crm_enabled && !r.has_telegram) {
        const linkRes = await fetch('/api/admin/users/crm-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ user_id: r.id }),
        })
        const linkJson = await linkRes.json()
        if (linkRes.ok && linkJson?.link) {
          try { await navigator.clipboard.writeText(linkJson.link) } catch {}
          alert(`✅ CRM включен для ${r.name || r.email}.\n\nСсылка на Домовой скопирована в буфер — отправь риелтору:\n${linkJson.link}`)
        }
      }

      await load()
    } catch (e) {
      alert(e.message || e)
    } finally {
      setBusyId(null)
    }
  }

  async function copyLink(r) {
    setBusyId(r.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/users/crm-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ user_id: r.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка')
      if (json?.link) {
        try { await navigator.clipboard.writeText(json.link) } catch {}
        alert(`Ссылка для ${r.name || r.email} скопирована:\n\n${json.link}`)
      }
    } catch (e) {
      alert(e.message || e)
    } finally {
      setBusyId(null)
    }
  }

  const active = realtors.filter(r => r.crm_enabled).length
  const withTg = realtors.filter(r => r.crm_enabled && r.has_telegram).length

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">CRM — риелторы и лиды</h2>
        <p className="mt-1 text-sm text-gray-600">
          CRM включён у {active} из {realtors.length} риелторов, из них {withTg} подключили бот «Домовой».
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium text-gray-900">Лимит активных лидов на риелтора</div>
            <div className="text-xs text-gray-500 mt-1">
              Когда ВКЛ: риелтору с {settings.limit_threshold}+ активных лидов (новый + в работе) не придёт карточка
              новой заявки.
              <br />Если все достигли лимита, заявка повиснет — через {settings.unclaimed_escalation_minutes} мин придёт уведомление об эскалации.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">Лимит:</span>
              <input
                type="number" min="1"
                value={settings.limit_threshold}
                onChange={e => {
                  const v = parseInt(e.target.value, 10)
                  if (Number.isInteger(v) && v > 0) setSettings(s => ({ ...s, limit_threshold: v }))
                }}
                onBlur={() => saveSettings({ limit_threshold: settings.limit_threshold })}
                disabled={savingSettings}
                className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm disabled:opacity-40"
              />
            </label>
            <button
              type="button"
              onClick={() => saveSettings({ limits_enabled: !settings.limits_enabled })}
              disabled={savingSettings}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-40 ${
                settings.limits_enabled ? 'bg-emerald-500' : 'bg-gray-300'
              }`}
            >
              <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${settings.limits_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <span className={`text-sm font-medium ${settings.limits_enabled ? 'text-emerald-700' : 'text-gray-500'}`}>
              {settings.limits_enabled ? 'ВКЛ' : 'ОТКЛ'}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium text-gray-900">Порог автоэскалации невзятых лидов</div>
            <div className="text-xs text-gray-500 mt-1">
              Если заявка лежит дольше этого времени без назначения — руководителю/админу
              приходит уведомление «⚠ Заявку никто не взял». Рекомендация: 30–60 минут.
              <br />Подсказка: «позвонить за 5 минут» всё равно остаётся целью для риелторов,
              просто сигнал эскалации срабатывает не так резко.
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">Минут:</span>
            <input
              type="number" min="1"
              value={settings.unclaimed_escalation_minutes}
              onChange={e => {
                const v = parseInt(e.target.value, 10)
                if (Number.isInteger(v) && v > 0) setSettings(s => ({ ...s, unclaimed_escalation_minutes: v }))
              }}
              onBlur={() => saveSettings({ unclaimed_escalation_minutes: settings.unclaimed_escalation_minutes })}
              disabled={savingSettings}
              className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm disabled:opacity-40"
            />
          </label>
        </div>
      </div>

      {err && <p className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{err}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Загрузка...</p>
      ) : realtors.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
          Активных риелторов нет.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">Риелтор</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">CRM</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Домовой</th>
                <th className="px-4 py-3 text-center font-medium text-gray-500" title="Взят, но не переведён дальше">Новых</th>
                <th className="px-4 py-3 text-center font-medium text-gray-500" title="Ведёт клиента после внесения в базу">В работе</th>
                <th className="px-4 py-3 text-center font-medium text-gray-500" title="Ждут подтверждения админа">Ждут базу</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Действия</th>
              </tr>
            </thead>
            <tbody>
              {realtors.map(r => {
                const c = counts[r.id] || { new_count: 0, add_to_base_count: 0, in_work_count: 0 }
                const activeTotal = c.new_count + c.in_work_count
                const overLimit = settings.limits_enabled && activeTotal >= settings.limit_threshold
                return (
                  <tr key={r.id} className={`border-b border-gray-100 hover:bg-gray-50 ${overLimit ? 'bg-rose-50/50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{r.name || '—'}</div>
                      <div className="text-xs text-gray-500">{r.email || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggle(r)}
                        disabled={busyId === r.id}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition disabled:opacity-40 ${
                          r.crm_enabled ? 'bg-emerald-500' : 'bg-gray-300'
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white transition ${r.crm_enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {r.has_telegram ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">✓ привязан</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">не привязан</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-center font-medium ${c.new_count > 0 ? 'text-blue-700' : 'text-gray-400'}`}>{c.new_count}</td>
                    <td className={`px-4 py-3 text-center font-medium ${c.in_work_count > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>{c.in_work_count}</td>
                    <td className={`px-4 py-3 text-center font-medium ${c.add_to_base_count > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{c.add_to_base_count}</td>
                    <td className="px-4 py-3 text-right">
                      {overLimit && (
                        <span className="mr-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700" title={`Новый+В работе = ${activeTotal} ≥ лимит ${settings.limit_threshold}. Новые заявки ему не приходят.`}>
                          ⚠ лимит
                        </span>
                      )}
                      {!r.has_telegram && (
                        <button
                          type="button"
                          onClick={() => copyLink(r)}
                          disabled={busyId === r.id}
                          className="rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 px-3 py-1 text-xs font-medium text-blue-700"
                        >
                          🔗 Скопировать ссылку
                        </button>
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
  )
}
