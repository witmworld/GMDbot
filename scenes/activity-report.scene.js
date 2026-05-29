// scenes/activity-report.scene.js
// Админ-отчёты по активности участников и обзор подписок.
// Доступ — только админам (isAdmin) или главному админу (ADMIN_USER_ID).

import { Scenes, Markup } from 'telegraf'
import { isAdmin } from '../utils/adminCheck.js'
import {
  topActive, dormantUsers, activityTotals, getUsersByIds,
  subscriptionOverview, recomputeUserActivity, rebuildDaily,
} from '../db/activityRepo.js'
import { SUPABASE_ENABLED } from '../db/supabase.js'

export const activityReportScene = new Scenes.BaseScene('ACTIVITY_REPORT')

const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID)

async function ensureAdmin(ctx) {
  if (ctx.from?.id === ADMIN_USER_ID) return true
  return await isAdmin(ctx.from.id)
}

function displayName(u, id) {
  if (!u) return `id:${id}`
  if (u.username) return `@${u.username}`
  const name = `${u.first_name || ''} ${u.last_name || ''}`.trim()
  return name || `id:${id}`
}

const WINDOW_LABELS = {
  events_7d: 'за 7 дней',
  events_30d: 'за 30 дней',
  events_90d: 'за 90 дней',
  events_365d: 'за 365 дней',
}

function menuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🏆 Топ активных · 7 дней', 'act:top:events_7d')],
    [Markup.button.callback('🏆 Топ активных · 30 дней', 'act:top:events_30d')],
    [Markup.button.callback('🏆 Топ активных · 90 дней', 'act:top:events_90d')],
    [Markup.button.callback('🏆 Топ активных · 365 дней', 'act:top:events_365d')],
    [Markup.button.callback('😴 Спящие (нет активности 30 дн.)', 'act:dormant')],
    [Markup.button.callback('💳 Обзор подписок', 'act:subs')],
    [Markup.button.callback('🔄 Пересчитать сейчас', 'act:recompute')],
    [Markup.button.callback('⬅️ Закрыть', 'act:exit')],
  ])
}

activityReportScene.enter(async (ctx) => {
  if (!(await ensureAdmin(ctx))) {
    await ctx.reply('❌ Нет доступа к отчётам по активности')
    return ctx.scene.leave()
  }
  if (!SUPABASE_ENABLED) {
    await ctx.reply('⚠️ Supabase не подключён (нет SUPABASE_URL / SUPABASE_SERVICE_KEY). Отчёты недоступны.')
    return ctx.scene.leave()
  }

  const totals = await activityTotals()
  let header = '📊 *Активность клуба*\n\n'
  if (totals) {
    header +=
      `Всего учтено участников: *${totals.users}*\n` +
      `Активны за 7 дней: *${totals.active_7d}*\n` +
      `Активны за 30 дней: *${totals.active_30d}*\n` +
      `Активны за 90 дней: *${totals.active_90d}*\n` +
      `Активны за 365 дней: *${totals.active_365d}*\n\n`
  }
  header += 'Выберите отчёт:'

  await ctx.reply(header, { parse_mode: 'Markdown', ...menuKeyboard() })
})

// ── Топ активных по выбранному окну ──────────────────────────────────
activityReportScene.action(/^act:top:(events_\d+d)$/, async (ctx) => {
  await ctx.answerCbQuery()
  const win = ctx.match[1]
  const rows = await topActive({ window: win, limit: 15 })
  if (!rows.length) {
    return ctx.reply('Пока нет данных по активности. Дайте боту собрать события или нажмите «Пересчитать сейчас».')
  }
  const users = await getUsersByIds(rows.map((r) => r.telegram_user_id))
  const lines = rows.map((r, i) => {
    const n = displayName(users[r.telegram_user_id], r.telegram_user_id)
    return `${i + 1}. ${n} — *${r[win]}* событий`
  })
  await ctx.reply(
    `🏆 *Топ активных ${WINDOW_LABELS[win]}*\n\n${lines.join('\n')}`,
    { parse_mode: 'Markdown' }
  )
})

// ── Спящие ────────────────────────────────────────────────────────────
activityReportScene.action('act:dormant', async (ctx) => {
  await ctx.answerCbQuery()
  const rows = await dormantUsers({ limit: 30 })
  if (!rows.length) {
    return ctx.reply('😌 Спящих участников не найдено (или пока недостаточно данных).')
  }
  const users = await getUsersByIds(rows.map((r) => r.telegram_user_id))
  const lines = rows.map((r) => {
    const n = displayName(users[r.telegram_user_id], r.telegram_user_id)
    const last = r.last_event_at ? new Date(r.last_event_at).toISOString().slice(0, 10) : '—'
    return `• ${n} — последняя активность: ${last} (за год: ${r.events_365d})`
  })
  await ctx.reply(
    `😴 *Спящие участники* (нет активности 30 дней)\n\n${lines.join('\n')}`,
    { parse_mode: 'Markdown' }
  )
})

// ── Обзор подписок ────────────────────────────────────────────────────
activityReportScene.action('act:subs', async (ctx) => {
  await ctx.answerCbQuery()
  const { byStatus, expiringSoon } = await subscriptionOverview({ soonDays: 7 })
  const statusOrder = ['active', 'expiring_soon', 'grace', 'expired', 'removed', 'cancelled']
  const statusLabels = {
    active: 'Активны', expiring_soon: 'Скоро истекут', grace: 'Грейс',
    expired: 'Истекли', removed: 'Удалены', cancelled: 'Отменены',
  }
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0)
  if (total === 0) {
    return ctx.reply('💳 Подписок в tg_club пока нет. Таблица заполняется импортом/вручную (оплата ведётся в старом потоке).')
  }
  let txt = '💳 *Обзор подписок*\n\n'
  for (const s of statusOrder) {
    if (byStatus[s]) txt += `${statusLabels[s]}: *${byStatus[s]}*\n`
  }
  if (expiringSoon.length) {
    const users = await getUsersByIds(expiringSoon.map((s) => s.telegram_user_id))
    txt += `\n⏳ *Истекают в ближайшие 7 дней (${expiringSoon.length}):*\n`
    txt += expiringSoon.slice(0, 20).map((s) => {
      const n = displayName(users[s.telegram_user_id], s.telegram_user_id)
      const d = new Date(s.ends_at).toISOString().slice(0, 10)
      return `• ${n} — ${s.plan_code || '—'} — до ${d}`
    }).join('\n')
  }
  await ctx.reply(txt, { parse_mode: 'Markdown' })
})

// ── Ручной пересчёт ───────────────────────────────────────────────────
activityReportScene.action('act:recompute', async (ctx) => {
  await ctx.answerCbQuery('Пересчитываю…')
  await ctx.reply('🔄 Пересчёт активности…')
  try {
    await rebuildDaily()
    const users = await recomputeUserActivity()
    await ctx.reply(`✅ Готово. Обновлено пользователей: ${users ?? 0}.`)
  } catch (e) {
    await ctx.reply('❌ Ошибка пересчёта: ' + e.message)
  }
})

activityReportScene.action('act:exit', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('Закрыто.')
  return ctx.scene.leave()
})
