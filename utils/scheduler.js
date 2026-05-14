import moment from 'moment-timezone'
import { getMessages, getClubMembers, clearSendFlag, updateMessage } from '../integrations/fillout.js'
import { buildPaymentUrl } from '../integrations/allpay.js'

const SCHEDULER_ID = Math.random().toString(36).substring(7)
console.log('[Scheduler] Instance ID:', SCHEDULER_ID)

const scheduledTimeouts = new Map()

// Накапливает статистику отправок вебинара для отчёта участникам ТЕСТ.
// Ключ: ISO-неделя (например "2026-W20"), значение: { base, practice, access, errors, testIds }
const webinarStats = new Map()

function getWeekKey(sendTimeStr) {
  if (!sendTimeStr) return 'unknown'
  return moment.tz(sendTimeStr, 'Asia/Jerusalem').startOf('isoWeek').format('GGGG-[W]WW')
}

// Возвращает true если участник оплатил вебинар не более 30 дней назад.
// Поле «Вебинар» может быть ISO строкой или dd/mm/yyyy.
export function hasActiveWebinarAccess(member) {
  const raw = member.fields['Вебинар']
  if (!raw) return false
  let paid
  if (raw.includes('T') || raw.includes('-')) {
    paid = new Date(raw)
  } else {
    const [dd, mm, yyyy] = raw.split('/')
    if (!dd || !mm || !yyyy) return false
    paid = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd))
  }
  if (isNaN(paid.getTime())) return false
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
  console.log(`[Scheduler] ТЕСТ members:`, allMembers.filter(m => m.fields['Тариф'] === 'ТЕСТ').length)
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
    console.log(`[Scheduler ${SCHEDULER_ID}] Broadcasting to ALL members (excl. ТЕСТ)`)
  } else if (broadcastPremium) {
    console.log(`[Scheduler ${SCHEDULER_ID}] Broadcasting to ПРЕМИУМ (all except БАЗА, ТЕСТ)`)
  } else if (broadcastBase) {
    console.log(`[Scheduler ${SCHEDULER_ID}] Broadcasting to БАЗА without active webinar payment + ТЕСТ`)
  } else if (broadcastPractice) {
    console.log(`[Scheduler ${SCHEDULER_ID}] Broadcasting to ПРАКТИКА without active webinar payment + ТЕСТ`)
  } else if (broadcastAccess) {
    console.log(`[Scheduler ${SCHEDULER_ID}] Broadcasting to ДОСТУП (ПРАКТИКА+, СОПРОВОЖДЕНИЕ, paid БАЗА/ПРАКТИКА) + ТЕСТ`)
  } else {
    console.log(`[Scheduler ${SCHEDULER_ID}] Broadcasting to tariff: ${tariff}`)
  }

  const targets = allMembers.filter(m => {
    const tgId       = m.fields['telegram_id']
    const userTariff = m.fields['Тариф']
    if (!tgId) return false

    // ТЕСТ не входит в общие рассылки — получает только явные вебинарные сообщения
    if (broadcastAll)     return userTariff !== 'ТЕСТ'
    if (broadcastPremium) return userTariff !== 'БАЗА' && userTariff !== 'ТЕСТ'

    // ТЕСТ получает все три вебинарных рассылки (БАЗА, ПРАКТИКА, ДОСТУП)
    if (broadcastBase) {
      return (userTariff === 'БАЗА' && !hasActiveWebinarAccess(m)) || userTariff === 'ТЕСТ'
    }

    if (broadcastPractice) {
      return (userTariff === 'ПРАКТИКА' && !hasActiveWebinarAccess(m)) || userTariff === 'ТЕСТ'
    }

    // ДОСТУП: ПРАКТИКА+ и СОПРОВОЖДЕНИЕ всегда,
    //         БАЗА и ПРАКТИКА — только с активной оплатой (≤30 дней),
    //         ТЕСТ — всегда
    if (broadcastAccess) {
      if (userTariff === 'ТЕСТ')           return true
      if (userTariff === 'ПРАКТИКА+')      return true
      if (userTariff === 'СОПРОВОЖДЕНИЕ')  return true
      if ((userTariff === 'БАЗА' || userTariff === 'ПРАКТИКА') && hasActiveWebinarAccess(m)) return true
      return false
    }

    return userTariff === tariff
  })

  // 24h webinar messages — create individual payment link per member
  const is24hWebinar = text.startsWith('Привет! 👋 Завтра') && (broadcastBase || broadcastPractice)

  let sent        = 0   // все включая ТЕСТ (для лога)
  let sentNonTest = 0   // без ТЕСТ (для отчёта)
  let errorsNonTest = 0

  for (const member of targets) {
    const tgId   = String(member.fields['telegram_id'])
    const isTEST = member.fields['Тариф'] === 'ТЕСТ'
    let messageText = text

    if (is24hWebinar) {
      const baseUrl = broadcastBase
        ? process.env.ALLPAY_LINK_BASE
        : process.env.ALLPAY_LINK_PRACTICE
      const paymentUrl = buildPaymentUrl(baseUrl, {
        clientName:  member.fields['Имя, фамилия'] || '',
        clientEmail: member.fields['Электронная почта '] || '',
        telegramId:  member.fields['telegram_id'],
      })
      messageText = text.replace(
        /₪: 👉 <a href="https?:\/\/[^"]*">[^<]*<\/a>/,
        `₪: 👉 <a href="${paymentUrl}">Оплатить</a>`
      )
    }

    try {
      await bot.telegram.sendMessage(tgId, messageText, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      })
      sent++
      if (!isTEST) sentNonTest++
    } catch (e) {
      console.error(`[Scheduler ${SCHEDULER_ID}] sendMessage failed for ${tgId}:`, e.message)
      if (!isTEST) errorsNonTest++
    }
  }

  console.log(`[Scheduler ${SCHEDULER_ID}] Sent to ${sent} recipients (${sentNonTest} non-TEST)`)

  // 24h webinar broadcast → mark as active so scheduler won't re-send after restart
  if (tariff === 'БАЗА' || tariff === 'ПРАКТИКА') {
    try {
      await updateMessage(id, { Active: true })
      console.log(`[Scheduler ${SCHEDULER_ID}] Set Active=true for ${tariff} message ${id}`)
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

  // Накапливаем статистику для отчёта ТЕСТ-участникам
  const isWebinarBroadcast = broadcastBase || broadcastPractice || broadcastAccess
  if (isWebinarBroadcast) {
    const weekKey = getWeekKey(msg.fields['Время рассылки'])
    const stats = webinarStats.get(weekKey) || { base: 0, practice: 0, access: 0, errors: 0, testIds: new Set() }

    if (broadcastBase)     stats.base     += sentNonTest
    if (broadcastPractice) stats.practice += sentNonTest
    if (broadcastAccess)   stats.access   += sentNonTest
    stats.errors += errorsNonTest

    targets
      .filter(m => m.fields['Тариф'] === 'ТЕСТ')
      .forEach(m => stats.testIds.add(String(m.fields['telegram_id'])))

    webinarStats.set(weekKey, stats)
    console.log(`[Scheduler ${SCHEDULER_ID}] ТЕСТ stats [${weekKey}]:`, {
      base: stats.base, practice: stats.practice, access: stats.access,
      errors: stats.errors, testCount: stats.testIds.size
    })

    // Отправляем отчёт после последнего сообщения вебинара (ДОСТУП 15м)
    if (broadcastAccess && text.startsWith('Через 15 минут') && stats.testIds.size > 0) {
      const report =
        `📊 Отчёт рассылки:\n` +
        `БАЗА: ${stats.base} сообщений отправлено\n` +
        `ПРАКТИКА: ${stats.practice} сообщений отправлено\n` +
        `ПРАКТИКА+, сопровождение: ${stats.access} сообщений отправлено\n` +
        `Ошибок: ${stats.errors}`
      for (const tgId of stats.testIds) {
        try {
          await bot.telegram.sendMessage(tgId, report)
          console.log(`[Scheduler ${SCHEDULER_ID}] ТЕСТ report sent to ${tgId}`)
        } catch (e) {
          console.error(`[Scheduler ${SCHEDULER_ID}] Failed to send ТЕСТ report to ${tgId}:`, e.message)
        }
      }
      webinarStats.delete(weekKey)
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
