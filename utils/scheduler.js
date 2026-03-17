import moment from 'moment-timezone'
import { getMessages, getClubMembers, clearSendFlag } from '../integrations/fillout.js'

const scheduledTimeouts = []

async function sendBroadcast(bot, msg) {
  const id     = msg.id
  const text   = msg.fields['Текст сообщения']
  const tariff = msg.fields['Тариф'] || null

  if (!text) {
    console.log(`[Scheduler] Skipping ID: ${id} — no text`)
    return
  }

  console.log(`[Scheduler] Sending broadcast ID: ${id} | tariff: "${tariff ?? 'all'}"`)

  try {
    await clearSendFlag(id)
  } catch (e) {
    console.error('[Scheduler] clearSendFlag failed:', e.message)
  }

  let allMembers
  try {
    allMembers = await getClubMembers()
  } catch (e) {
    console.error('[Scheduler] getClubMembers failed:', e.message)
    return
  }

  const targets = allMembers.filter(m => {
    const tgId       = m.fields['telegram_id']
    const userTariff = m.fields['Тариф']
    if (!tgId) return false
    if (tariff) return userTariff === tariff
    return true
  })

  let sent = 0
  for (const member of targets) {
    try {
      await bot.telegram.sendMessage(String(member.fields['telegram_id']), text)
      sent++
    } catch (e) {
      console.error(`[Scheduler] sendMessage failed for ${member.fields['telegram_id']}:`, e.message)
    }
  }

  console.log(`[Scheduler] Broadcast sent: ${sent} recipients for tariff "${tariff ?? 'all'}"`)
}

export async function checkScheduledMessages(bot) {
  console.log('[Scheduler] checkScheduledMessages() called')

  // Clear old scheduled timers
  for (const t of scheduledTimeouts) clearTimeout(t)
  scheduledTimeouts.length = 0

  let messages
  try {
    messages = await getMessages()
  } catch (e) {
    console.error('[Scheduler] getMessages failed:', e.message)
    return
  }

  const pending = messages.filter(m => m.fields['send'] === true)
  console.log(`[Scheduler] Found ${pending.length} pending message(s) with send=true`)

  if (!pending.length) return

  const now = Date.now()

  for (const msg of pending) {
    const sendTimeStr = msg.fields['Время рассылки']
    const sendTime    = sendTimeStr ? new Date(sendTimeStr).getTime() : null

    if (!sendTime || isNaN(sendTime) || sendTime <= now) {
      // Send immediately
      console.log(`[Scheduler] Sending immediately: ID ${msg.id}`)
      await sendBroadcast(bot, msg)
    } else {
      // Schedule for future
      const delay   = sendTime - now
      const minutes = Math.round(delay / 60_000)
      console.log(`[Scheduler] Scheduled: ID ${msg.id} in ${minutes} min (${new Date(sendTime).toISOString()})`)
      const t = setTimeout(() => sendBroadcast(bot, msg), delay)
      scheduledTimeouts.push(t)
    }
  }
}

function scheduleDailyAt18(bot) {
  const now    = moment.tz('Asia/Jerusalem')
  const next18 = moment.tz('Asia/Jerusalem').hour(18).minute(0).second(0).millisecond(0)
  if (!next18.isAfter(now)) next18.add(1, 'day')

  const delay   = next18.valueOf() - now.valueOf()
  const minutes = Math.round(delay / 60_000)
  console.log(`[Scheduler] Current time (Jerusalem): ${now.format('HH:mm')}`)
  console.log(`[Scheduler] Next daily check at 18:00 — in ${minutes} min`)

  setTimeout(() => {
    checkScheduledMessages(bot)
    scheduleDailyAt18(bot)
  }, delay)
}

export function startScheduler(bot) {
  console.log('[Scheduler] Started — daily check at 18:00')
  scheduleDailyAt18(bot)
}
