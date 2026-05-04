import moment from 'moment-timezone'
import { getMessages, getClubMembers, clearSendFlag, updateMessage } from '../integrations/fillout.js'
import { createPaymentLink } from '../integrations/allpay.js'

const SCHEDULER_ID = Math.random().toString(36).substring(7)
console.log('[Scheduler] Instance ID:', SCHEDULER_ID)

const scheduledTimeouts = new Map()

// Возвращает true если участник оплатил вебинар не более 30 дней назад.
// Поле «Вебинар» хранится в формате dd/mm/yyyy.
export function hasActiveWebinarAccess(member) {
  const raw = member.fields['Вебинар']
  if (!raw) return false
  const [dd, mm, yyyy] = raw.split('/')
  if (!dd || !mm || !yyyy) return false
  const paid = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd))
  const diffDays = (Date.now() - paid.getTime()) / (1000 * 60 * 60 * 24)
  return diffDays <= 30
}

async function sendBroadcast(bot, msg) {
  const id     = msg.id
  const text   = msg.fields['Текст сообщения']
  const tariff = msg.fields['Тариф'] || null

  if (!text) {
    console.log(`[Scheduler] Skipping ID: ${id} — no text`)
    return
  }

  console.log(`[Scheduler ${SCHEDULER_ID}] Sending broadcast ID: ${id} | tariff: "${tariff ?? 'none'}"`)

  try {
    await clearSendFlag(id)
  } catch (e) {
    console.error(`[Scheduler ${SCHEDULER_ID}] clearSendFlag failed:`, e.message)
  }

  let allMembers
  try {
    allMembers = await getClubMembers()
  } catch (e) {
    console.error(`[Scheduler ${SCHEDULER_ID}] getClubMembers failed:`, e.message)
    return
  }

  console.log(`[Scheduler] All members count:`, allMembers.length)
  console.log(`[Scheduler] БАЗА members:`, allMembers.filter(m => m.fields['Тариф'] === 'БАЗА').length)
  console.log(`[Scheduler] ПРАКТИКА members:`, allMembers.filter(m => m.fields['Тариф'] === 'ПРАКТИКА').length)
  console.log(`[Scheduler] БАЗА with telegram_id:`, allMembers.filter(m => m.fields['Тариф'] === 'БАЗА' && m.fields['telegram_id']).length)
  console.log(`[Scheduler] БАЗА sample (first 3):`, JSON.stringify(
    allMembers.filter(m => m.fields['Тариф'] === 'БАЗА').slice(0, 3).map(m => ({
      Тариф: m.fields['Тариф'],
      telegram_id: m.fields['telegram_id'],
      Вебинар: m.fields['Вебинар'],
    }))
  ))

  const broadcastAll      = !tariff || tariff === 'ВСЕ' || tariff === 'КЛУБ'
  const broadcastPremium  = tariff === 'ПРЕМИУМ'
  const broadcastBase     = tariff === 'БАЗА'
  const broadcastPractice = tariff === 'ПРАКТИКА'
  const broadcastAccess   = tariff === 'ДОСТУП'

  if (broadcastAll) {
    console.log(`[Scheduler ${SCHEDULER_ID}] Broadcasting to ALL members`)
  } else if (broadcastPremium) {
    console.log(`[Scheduler ${SCHEDULER_ID}] Broadcasting to ПРЕМИУМ (all except БАЗА)`)
  } else if (broadcastBase) {
    console.log(`[Scheduler ${SCHEDULER_ID}] Broadcasting to БАЗА without active webinar payment`)
  } else if (broadcastPractice) {
    console.log(`[Scheduler ${SCHEDULER_ID}] Broadcasting to ПРАКТИКА without active webinar payment`)
  } else if (broadcastAccess) {
    console.log(`[Scheduler ${SCHEDULER_ID}] Broadcasting to ДОСТУП (ПРАКТИКА+, СОПРОВОЖДЕНИЕ, paid БАЗА/ПРАКТИКА)`)
  } else {
    console.log(`[Scheduler ${SCHEDULER_ID}] Broadcasting to tariff: ${tariff}`)
  }

  const targets = allMembers.filter(m => {
    const tgId       = m.fields['telegram_id']
    const userTariff = m.fields['Тариф']
    if (!tgId) return false

    if (broadcastAll)     return true
    if (broadcastPremium) return userTariff !== 'БАЗА'

    // БАЗА: только те кто НЕ оплатил или оплата просрочена
    if (broadcastBase) {
      return userTariff === 'БАЗА' && !hasActiveWebinarAccess(m)
    }

    // ПРАКТИКА: только те кто НЕ оплатил или оплата просрочена
    if (broadcastPractice) {
      return userTariff === 'ПРАКТИКА' && !hasActiveWebinarAccess(m)
    }

    // ДОСТУП: ПРАКТИКА+ и СОПРОВОЖДЕНИЕ всегда,
    //         БАЗА и ПРАКТИКА — только с активной оплатой (≤30 дней)
    if (broadcastAccess) {
      if (userTariff === 'ПРАКТИКА+')     return true
      if (userTariff === 'СОПРОВОЖДЕНИЕ') return true
      if ((userTariff === 'БАЗА' || userTariff === 'ПРАКТИКА') && hasActiveWebinarAccess(m)) return true
      return false
    }

    return userTariff === tariff
  })

  // 24h webinar messages — create individual payment link per member
  const is24hWebinar = text.startsWith('Привет! 👋 Завтра') && (broadcastBase || broadcastPractice)

  let sent = 0
  for (const member of targets) {
    const tgId = String(member.fields['telegram_id'])
    let messageText = text

    if (is24hWebinar) {
      const amount        = broadcastBase ? 50 : 30
      const orderId       = broadcastBase
        ? `${tgId}_webinar_base_${Date.now()}`
        : `${tgId}_webinar_practice_${Date.now()}`
      const description   = broadcastBase
        ? 'Доступ на вебинар - БАЗА'
        : 'Запись вебинара - ПРАКТИКА'
      const customerPhone = member.fields['Телефон'] || ''
      const customerEmail = member.fields['Электронная почта '] || ''

      try {
        const paymentUrl = await createPaymentLink({ orderId, amount, description, customerPhone, customerEmail })
        messageText = text.replace(
          /₪: 👉 <a href="https?:\/\/[^"]*">[^<]*<\/a>/,
          `₪: 👉 <a href="${paymentUrl}">Оплатить</a>`
        )
      } catch (e) {
        console.error(`[Scheduler ${SCHEDULER_ID}] createPaymentLink failed for ${tgId}:`, e.message)
        messageText = text.replace(
          /₪: 👉 <a href="https?:\/\/[^"]*">[^<]*<\/a>/,
          '₪: для оплаты пишите @where_is_themoney'
        )
      }
    }

    try {
      await bot.telegram.sendMessage(tgId, messageText, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      })
      sent++
    } catch (e) {
      console.error(`[Scheduler ${SCHEDULER_ID}] sendMessage failed for ${tgId}:`, e.message)
    }
  }

  console.log(`[Scheduler ${SCHEDULER_ID}] Sent to ${sent} recipients`)

  // БАЗА 24h → пометить вебинар как активный
  if (tariff === 'БАЗА') {
    try {
      await updateMessage(id, { Active: true })
      console.log(`[Scheduler ${SCHEDULER_ID}] Set Active=true for БАЗА message ${id}`)
    } catch (e) {
      console.error(`[Scheduler ${SCHEDULER_ID}] Failed to set Active=true:`, e.message)
    }
  }

  // 15-минутное сообщение → деактивировать все записи этого вебинара
  if (text && text.startsWith('Через 15 минут')) {
    try {
      const sendTimeStr = msg.fields['Время рассылки']
      const thisSend = sendTimeStr ? new Date(sendTimeStr).getTime() : null
      if (thisSend) {
        const allMsgs = await getMessages()
        const toDeactivate = allMsgs.filter(m => {
          const t = m.fields['Время рассылки']
          if (!t) return false
          return Math.abs(new Date(t).getTime() - thisSend) <= 25 * 60 * 60 * 1000
        })
        for (const rec of toDeactivate) {
          await updateMessage(rec.id, { Active: false })
        }
        console.log(`[Scheduler ${SCHEDULER_ID}] Set Active=false on ${toDeactivate.length} webinar records`)
      }
    } catch (e) {
      console.error(`[Scheduler ${SCHEDULER_ID}] Failed to deactivate webinar records:`, e.message)
    }
  }

  // После успешной отправки
  scheduledTimeouts.delete(msg.id)
}

export async function checkScheduledMessages(bot) {
  console.log(`[Scheduler ${SCHEDULER_ID}] ===== CHECK STARTED =====`)
  console.log(`[Scheduler ${SCHEDULER_ID}] Current time (Jerusalem):`, moment.tz('Asia/Jerusalem').format('DD.MM.YYYY HH:mm:ss'))

  // Очистить все старые таймеры
  for (const [id, timeoutId] of scheduledTimeouts.entries()) {
    clearTimeout(timeoutId)
    console.log(`[Scheduler ${SCHEDULER_ID}] Cleared old timeout:`, id)
  }
  scheduledTimeouts.clear()

  let messages
  try {
    messages = await getMessages()
  } catch (e) {
    console.error(`[Scheduler ${SCHEDULER_ID}] getMessages failed:`, e.message)
    return
  }

  const pending = messages.filter(m => m.fields['send'] === true)
  console.log(`[Scheduler ${SCHEDULER_ID}] Found messages with send=true:`, pending.length)
  pending.forEach(rec => {
    console.log(`  - Message ID: ${rec.id} Scheduled for: ${rec.fields['Время рассылки']} Tariff: ${rec.fields['Тариф']}`)
  })

  if (!pending.length) return

  const nowMoment = moment.tz('Asia/Jerusalem')

  const overdueMessages = []
  const futureMessages  = []

  for (const msg of pending) {
    const sendTimeStr = msg.fields['Время рассылки']
    const sendMoment  = sendTimeStr ? moment.tz(sendTimeStr, 'Asia/Jerusalem') : null

    if (!sendMoment || !sendMoment.isValid() || !sendMoment.isAfter(nowMoment)) {
      overdueMessages.push(msg)
    } else {
      futureMessages.push({ msg, sendMoment })
    }
  }

  console.log(`[Scheduler ${SCHEDULER_ID}] Overdue messages (send now):`, overdueMessages.length)
  console.log(`[Scheduler ${SCHEDULER_ID}] Future messages (schedule setTimeout):`, futureMessages.length)

  futureMessages.forEach(({ msg, sendMoment }) => {
    const delay = sendMoment.diff(moment.tz('Asia/Jerusalem'))
    console.log(`  - Will send at: ${sendMoment.format('DD.MM HH:mm')} in ${Math.round(delay / 60000)} minutes`)
  })

  for (const msg of overdueMessages) {
    console.log(`[Scheduler ${SCHEDULER_ID}] Sending immediately: ID ${msg.id}`)
    await sendBroadcast(bot, msg)
  }

  for (const { msg, sendMoment } of futureMessages) {
    const delay = sendMoment.diff(moment.tz('Asia/Jerusalem'))
    const timeoutId = setTimeout(() => sendBroadcast(bot, msg), delay)
    scheduledTimeouts.set(msg.id, timeoutId)
    console.log(`[Scheduler ${SCHEDULER_ID}] Scheduled timeout for message:`, msg.id)
  }
}

function scheduleDailyAt18(bot) {
  const now    = moment.tz('Asia/Jerusalem')
  const next18 = moment.tz('Asia/Jerusalem').hour(18).minute(0).second(0).millisecond(0)
  if (!next18.isAfter(now)) next18.add(1, 'day')

  const delay   = next18.valueOf() - now.valueOf()
  const minutes = Math.round(delay / 60_000)
  console.log(`[Scheduler ${SCHEDULER_ID}] Current time (Jerusalem): ${now.format('HH:mm')}`)
  console.log(`[Scheduler ${SCHEDULER_ID}] Next daily check at 18:00 — in ${minutes} min`)

  setTimeout(() => {
    checkScheduledMessages(bot)
    scheduleDailyAt18(bot)
  }, delay)
}

export function startScheduler(bot) {
  console.log(`[Scheduler ${SCHEDULER_ID}] Started — daily check at 18:00`)
  // Подхватить pending таймауты после рестарта Railway
  checkScheduledMessages(bot)
  scheduleDailyAt18(bot)
}

// Алиас для явного вызова при рестарте
export { checkScheduledMessages as scheduleCheck }
