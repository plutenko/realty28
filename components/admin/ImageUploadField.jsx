import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

/**
 * Загрузка в bucket `images`, запись в таблицу images.
 */
export default function ImageUploadField({
  entityType,
  entityId,
  recordFields = null,
  onUploaded,
  label = 'Фото',
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function onChange(e) {
    const file = e.target.files?.[0]
    if (!file || !entityId || !supabase) return

    setBusy(true)
    setErr('')

    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const extraSeg =
        recordFields && typeof recordFields === 'object'
          ? Object.entries(recordFields)
              .filter(([, v]) => v != null && v !== '')
              .map(([k, v]) => `${k}_${v}`)
              .join('/')
          : ''
      const path = extraSeg
        ? `${entityType}/${entityId}/${extraSeg}/${Date.now()}.${ext}`
        : `${entityType}/${entityId}/${Date.now()}.${ext}`

      const { error: upErr } = await supabase.storage
        .from('images')
        .upload(path, file, { upsert: true })

      if (upErr) throw upErr

      const { data: pub } = supabase.storage.from('images').getPublicUrl(path)
      const url = pub.publicUrl

      const row = {
        entity_type: entityType,
        entity_id: entityId,
        url,
        ...(recordFields && typeof recordFields === 'object' ? recordFields : {}),
      }

      if (recordFields && typeof recordFields === 'object') {
        let del = supabase
          .from('images')
          .delete()
          .eq('entity_type', entityType)
          .eq('entity_id', entityId)
        for (const [k, v] of Object.entries(recordFields)) {
          del = del.eq(k, v)
        }
        const { error: delErr } = await del
        if (delErr && !/floor_level|column/i.test(String(delErr.message || ''))) {
          throw delErr
        }
      }

      const { error: insErr } = await supabase.from('images').insert(row)

      if (insErr) throw insErr

      onUploaded?.(url)
    } catch (e) {
      setErr(e?.message || 'Ошибка загрузки')
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  return (
    <div className="space-y-1">
      <div className="text-xs text-slate-400">{label}</div>
      <input
        type="file"
        accept="image/*"
        disabled={busy || !entityId}
        onChange={onChange}
        className="block w-full text-sm text-slate-200 file:mr-2 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-1.5"
      />
      {err ? <p className="text-xs text-rose-400">{err}</p> : null}
      {busy ? <p className="text-xs text-slate-500">Загрузка…</p> : null}
    </div>
  )
}
