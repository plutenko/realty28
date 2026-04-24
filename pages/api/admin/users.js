import crypto from 'crypto'
import { getSupabaseAdmin } from '../../../lib/supabaseServer'
import * as reportsBot from '../../../lib/reportsTelegram'

async function requireAdmin(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const supabase = getSupabaseAdmin()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  return profile?.role === 'admin' ? user : null
}

export default async function handler(req, res) {
  const supabase = getSupabaseAdmin()

  const caller = await requireAdmin(req)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  // GET — список пользователей
  if (req.method === 'GET') {
    const { data: { users }, error } = await supabase.auth.admin.listUsers()
    if (error) return res.status(500).json({ error: error.message })

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, role, name, email, is_active, fired_at, crm_enabled, telegram_chat_id')

    const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]))

    // last_used_at из user_devices = реальный последний вход на платформу
    // (в отличие от auth.last_sign_in_at, которое обновляется даже при незавершённом device-approve)
    const { data: devicesRaw } = await supabase
      .from('user_devices')
      .select('user_id, last_used_at')
      .order('last_used_at', { ascending: false })
    const lastPlatformLoginByUser = {}
    for (const d of devicesRaw ?? []) {
      if (!lastPlatformLoginByUser[d.user_id]) {
        lastPlatformLoginByUser[d.user_id] = d.last_used_at
      }
    }

    const result = users.map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: lastPlatformLoginByUser[u.id] ?? u.last_sign_in_at,
      role: profileMap[u.id]?.role ?? null,
      name: profileMap[u.id]?.name ?? null,
      is_active: profileMap[u.id]?.is_active ?? true,
      fired_at: profileMap[u.id]?.fired_at ?? null,
      crm_enabled: profileMap[u.id]?.crm_enabled ?? false,
      has_telegram: Boolean(profileMap[u.id]?.telegram_chat_id),
    }))

    return res.status(200).json(result)
  }

  // POST — создать пользователя
  if (req.method === 'POST') {
    const { email, password, role, name } = req.body
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'email, password и role обязательны' })
    }
    if (!['realtor', 'manager'].includes(role)) {
      return res.status(400).json({ error: 'role должен быть realtor или manager' })
    }

    const { data: { user }, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createError) return res.status(400).json({ error: createError.message })

    const { error: profileError } = await supabase
      .from('profiles')
      .insert({ id: user.id, role, name: name || null, email })

    if (profileError) {
      await supabase.auth.admin.deleteUser(user.id)
      return res.status(500).json({ error: profileError.message })
    }

    return res.status(201).json({ id: user.id, email, role, name })
  }

  // PATCH — изменить имя/роль/пароль/активность/CRM
  if (req.method === 'PATCH') {
    const { id, role, name, password, is_active, crm_enabled } = req.body
    if (!id) return res.status(400).json({ error: 'id обязателен' })

    const updates = {}
    if (role) {
      if (!['realtor', 'manager'].includes(role)) {
        return res.status(400).json({ error: 'Нельзя назначать роль admin' })
      }
      updates.role = role
    }
    if (name !== undefined) updates.name = name
    if (typeof is_active === 'boolean') {
      updates.is_active = is_active
      updates.fired_at = is_active ? null : new Date().toISOString()
    }
    if (typeof crm_enabled === 'boolean') updates.crm_enabled = crm_enabled

    // Если включили CRM, а Домовой-бот не привязан — сразу шлём приглашение
    // через рапорт-бота (в ЛС или fallback в группу с упоминанием)
    let inviteStatus = null
    if (crm_enabled === true) {
      const { data: target } = await supabase
        .from('profiles')
        .select('id, name, email, role, telegram_chat_id, telegram_user_id')
        .eq('id', id)
        .single()
      if (target && !target.telegram_chat_id) {
        inviteStatus = await sendCrmInvitation(supabase, target)
      }
    }
    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('profiles').update(updates).eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
    }

    if (password) {
      const { error } = await supabase.auth.admin.updateUserById(id, { password })
      if (error) return res.status(500).json({ error: error.message })
    }

    return res.status(200).json({ ok: true, invite: inviteStatus })
  }

  // DELETE — "уволить" (soft-delete профиля, auth-юзер остаётся).
  // Хард-удаление убрано — оно бы каскадом снесло исторические daily_reports.
  if (req.method === 'DELETE') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id обязателен' })

    if (id === caller.id) {
      return res.status(400).json({ error: 'Нельзя уволить свой аккаунт' })
    }

    const { error } = await supabase
      .from('profiles')
      .update({ is_active: false, fired_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return res.status(500).json({ error: error.message })

    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

async function sendCrmInvitation(supabase, target) {
  // Генерируем свежий код и сохраняем в профиль
  const code = crypto.randomBytes(8).toString('hex')
  await supabase.from('profiles').update({ telegram_link_code: code }).eq('id', target.id)

  // Собираем ссылку на Домовой
  let botUsername = process.env.TELEGRAM_BOT_USERNAME || ''
  if (!botUsername && process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`)
      const j = await r.json()
      if (j?.ok) botUsername = j.result?.username || ''
    } catch {}
  }
  if (!botUsername) botUsername = 'domovoy_login_bot'
  const link = `https://t.me/${botUsername}?start=${code}`

  const nameHtml = reportsBot.escapeHtml(target.name || target.email || 'коллега')

  // 1. Пробуем ЛС через Старшину
  if (target.telegram_user_id) {
    try {
      const resp = await reportsBot.sendMessage(
        target.telegram_user_id,
        `🎯 <b>Тебе включили CRM</b>\n\n` +
        `Теперь получаешь заявки клиентов в Telegram.\n\n` +
        `Нажми, чтобы подключиться:\n${link}\n\n` +
        `После клика жми «Start» — дальше лиды сами будут прилетать в бот «Домовой».`,
        { parseMode: 'HTML' }
      )
      if (resp?.ok) return { method: 'dm', link }
    } catch {}
  }

  // Fallback — возвращаем ссылку, админ скинет риелтору сам
  return { method: 'manual', link }
}
