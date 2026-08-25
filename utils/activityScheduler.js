// utils/activityScheduler.js
// Ежедневная фоновая задача пересчёта активности.
//  1) rebuild_daily(вчера)        — дневные агрегаты за прошедший день
//  2) recompute_user_activity()   — окна 7/30/90/365 по всем пользователям
//
// Запускается раз в сутки в 00:20 по Иерусалиму. Использует moment-timezone
// (как и основной планировщик бота) и setTimeout-цепочку.

import moment from 'moment-timezone'
import { rebuildDaily, recomputeUserActivity } from '../db/activityRepo.js'
import { SUPABASE_ENABLED } from '../db/supabase.js'

const TZ = 'Asia/Jerusalem'
const RUN_HOUR = 0
const RUN_MINUTE = 20

let timer = null

export async function runActivityRecompute() {
  if (!SUPABASE_ENABLED) {
    console.warn('[activityScheduler] Supabase отключён — пересчёт пропущен')
    return { daily: null, users: null }
  }
  console.log('[activityScheduler] Старт ежедневного пересчёта активности')
  const daily = await rebuildDaily() // по умолчанию — вчера (UTC)
  const users = await recomputeUserActivity()
  console.log(`[activityScheduler] Готово: дневных строк=${daily}, пользователей=${users}`)
  return { daily, users }
}

function msUntilNextRun() {
  const now = moment.tz(TZ)
  let next = moment.tz(TZ).hour(RUN_HOUR).minute(RUN_MINUTE).second(0).millisecond(0)
  if (next.isSameOrBefore(now)) next = next.add(1, 'day')
  return next.diff(now)
}

function scheduleNext() {
  const delay = msUntilNextRun()
  const at = moment.tz(TZ).add(delay, 'ms').format('DD.MM.YYYY HH:mm:ss')
  console.log(`[activityScheduler] Следующий пересчёт: ${at} (${TZ})`)
  timer = setTimeout(async () => {
    try {
      await runActivityRecompute()
    } catch (e) {
      console.error('[activityScheduler] Ошибка пересчёта:', e.message)
    } finally {
      scheduleNext() // перепланировать на следующий день
    }
  }, delay)
}

// Запуск планировщика активности. runOnStart=true — сделать пересчёт сразу.
export function startActivityScheduler({ runOnStart = false } = {}) {
  if (!SUPABASE_ENABLED) {
    console.warn('[activityScheduler] Supabase отключён — планировщик активности не запущен')
    return
  }
  if (timer) clearTimeout(timer)
  if (runOnStart) {
    runActivityRecompute().catch((e) => console.error('[activityScheduler] startup recompute:', e.message))
  }
  scheduleNext()
  console.log('[activityScheduler] Планировщик активности запущен')
}
