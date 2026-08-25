// db/activityRepo.js
// Репозиторий активности и подписок (схема tg_club).
// Все функции безопасны при отключённом Supabase (no-op).

import { supabase, SUPABASE_ENABLED } from './supabase.js'

// ─── Пользователи ────────────────────────────────────────────────────
// Upsert участника по telegram_user_id. Обновляет username/имя/last_seen.
export async function upsertTgUser(from, { isInGroup } = {}) {
  if (!SUPABASE_ENABLED || !from?.id) return null
  const row = {
    telegram_user_id: from.id,
    username: from.username || null,
    first_name: from.first_name || null,
    last_name: from.last_name || null,
    language_code: from.language_code || null,
    is_bot: !!from.is_bot,
    last_seen_at: new Date().toISOString(),
  }
  if (isInGroup === true) row.is_in_group = true
  if (isInGroup === false) {
    row.is_in_group = false
    row.left_at = new Date().toISOString()
  }
  const { error } = await supabase
    .from('tg_users')
    .upsert(row, { onConflict: 'telegram_user_id' })
  if (error) console.error('[activityRepo] upsertTgUser:', error.message)
  return null
}

// ─── События активности ──────────────────────────────────────────────
// Пишет одно событие в сырой лог. Никогда не бросает наружу.
export async function logEvent(evt) {
  if (!SUPABASE_ENABLED || !evt?.telegram_user_id) return
  const row = {
    telegram_user_id: evt.telegram_user_id,
    chat_id: evt.chat_id ?? null,
    event_type: evt.event_type,
    message_id: evt.message_id ?? null,
    is_reply: !!evt.is_reply,
    reply_to_user_id: evt.reply_to_user_id ?? null,
    text_length: evt.text_length ?? null,
    is_command: !!evt.is_command,
    metadata: evt.metadata ?? null,
    sent_at: evt.sent_at ?? new Date().toISOString(),
  }
  const { error } = await supabase.from('tg_activity_events').insert(row)
  if (error) console.error('[activityRepo] logEvent:', error.message)
}

// ─── Пересчёты (вызывает планировщик) ────────────────────────────────
export async function rebuildDaily(targetDate) {
  if (!SUPABASE_ENABLED) return null
  const args = targetDate ? { target_date: targetDate } : {}
  const { data, error } = await supabase.rpc('rebuild_daily', args)
  if (error) { console.error('[activityRepo] rebuildDaily:', error.message); return null }
  return data
}

export async function recomputeUserActivity() {
  if (!SUPABASE_ENABLED) return null
  const { data, error } = await supabase.rpc('recompute_user_activity')
  if (error) { console.error('[activityRepo] recomputeUserActivity:', error.message); return null }
  return data
}

// ─── Отчёты для админов ───────────────────────────────────────────────
// Топ активных пользователей за окно (events_7d|events_30d|events_90d|events_365d).
export async function topActive({ window = 'events_30d', limit = 15 } = {}) {
  if (!SUPABASE_ENABLED) return []
  const { data, error } = await supabase
    .from('tg_user_activity')
    .select(`telegram_user_id, events_7d, events_30d, events_90d, events_365d, messages_30d, last_event_at`)
    .order(window, { ascending: false })
    .limit(limit)
  if (error) { console.error('[activityRepo] topActive:', error.message); return [] }
  return data || []
}

// Тихие/спящие: нет событий за 30 дней, но были за 365.
export async function dormantUsers({ limit = 30 } = {}) {
  if (!SUPABASE_ENABLED) return []
  const { data, error } = await supabase
    .from('tg_user_activity')
    .select(`telegram_user_id, events_30d, events_90d, events_365d, last_event_at`)
    .eq('events_30d', 0)
    .gt('events_365d', 0)
    .order('last_event_at', { ascending: true })
    .limit(limit)
  if (error) { console.error('[activityRepo] dormantUsers:', error.message); return [] }
  return data || []
}

// Сводные счётчики по окнам (для шапки отчёта).
export async function activityTotals() {
  if (!SUPABASE_ENABLED) return null
  const { data, error } = await supabase
    .from('tg_user_activity')
    .select('events_7d, events_30d, events_90d, events_365d')
  if (error) { console.error('[activityRepo] activityTotals:', error.message); return null }
  const acc = { users: 0, active_7d: 0, active_30d: 0, active_90d: 0, active_365d: 0 }
  for (const r of data || []) {
    acc.users++
    if (r.events_7d > 0) acc.active_7d++
    if (r.events_30d > 0) acc.active_30d++
    if (r.events_90d > 0) acc.active_90d++
    if (r.events_365d > 0) acc.active_365d++
  }
  return acc
}

// Достаём username/имя пачкой по списку id (для красивого вывода).
export async function getUsersByIds(ids) {
  if (!SUPABASE_ENABLED || !ids?.length) return {}
  const { data, error } = await supabase
    .from('tg_users')
    .select('telegram_user_id, username, first_name, last_name')
    .in('telegram_user_id', ids)
  if (error) { console.error('[activityRepo] getUsersByIds:', error.message); return {} }
  const map = {}
  for (const u of data || []) map[u.telegram_user_id] = u
  return map
}

// ─── Подписки (только отслеживание, без оплаты) ──────────────────────
// Обзор: количество по статусам + кто истекает в ближайшие N дней.
export async function subscriptionOverview({ soonDays = 7 } = {}) {
  if (!SUPABASE_ENABLED) return { byStatus: {}, expiringSoon: [] }
  const { data: all, error } = await supabase
    .from('tg_subscriptions')
    .select('telegram_user_id, plan_code, status, ends_at')
  if (error) { console.error('[activityRepo] subscriptionOverview:', error.message); return { byStatus: {}, expiringSoon: [] } }

  const byStatus = {}
  const now = Date.now()
  const soonMs = soonDays * 24 * 60 * 60 * 1000
  const expiringSoon = []
  for (const s of all || []) {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1
    if (s.ends_at) {
      const diff = new Date(s.ends_at).getTime() - now
      if (diff > 0 && diff <= soonMs) expiringSoon.push(s)
    }
  }
  expiringSoon.sort((a, b) => new Date(a.ends_at) - new Date(b.ends_at))
  return { byStatus, expiringSoon }
}
