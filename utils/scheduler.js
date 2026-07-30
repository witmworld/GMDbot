import moment from 'moment-timezone'
import { getMessages, getClubMembers, clearSendFlag, updateMessage } from '../integrations/fillout.js'
import { buildPaymentUrl } from '../integrations/allpay.js'

const SCHEDULER_ID = Math.random().toString(36).substring(7)
console.log('[Scheduler] Instance ID:', SCHEDULER_ID)

const scheduledTimeouts = new Map()

const escapeHtmlAttr = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Админы набирают текст рассылок в Fillout в markdown, а отправка идёт с
// parse_mode: 'HTML' — markdown не парсится, и в Telegram видно квадратные
// скобки и дубль URL текстом. Переводим markdown в HTML перед отправкой:
// [ссылка на вебинар](url) → кликабельное «ссылка на вебинар» без скобок.
//
// Готовые <a href="...">...</a> из шаблонов не трогаются: в них нет
// квадратных скобок, поэтому под регулярку они не попадают.
// Экранируются только URL и подпись, извлечённые из markdown (они по
// определению не HTML) — текст целиком НЕ экранируется, иначе поломались бы
// уже вставленные теги.
export function mdToHtml(text) {
  if (!text) return text
  return text
    .replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
      (_, label, url) => `<a href="${escapeHtmlAttr(url)}">${escapeHtmlAttr(label)}</a>`
    )
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<b>$2</b>')
}

// Сдвиг внутри одного слота рассылки (за 24ч / 1ч / 15мин), чтобы записи
// разных тарифов не приходились на одну и ту же минуту.
// КЛУБ идёт по базовому времени — в мероприятиях это единственный тариф в слоте.
export const TARIFF_SEND_OFFSET_MIN = {
  'БАЗА':     0,
  'КЛУБ':     0,
  'ПРАКТИКА': 2,
  'ДОСТУП':   4,
  'ТЕСТ':     6,
}

// slot — moment базового времени слота; не мутируется.
export function slotSendTime(slot, tariff) {
  return slot.clone().add(TARIFF_SEND_OFFSET_MIN[tariff] ?? 0, 'minutes')
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
  const text   = mdToHtml(msg.fields['Текст сообщения'])
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
    console.log(`[Scheduler ${SCHEDULER_ID}] Broadcasting to ALL members (incl. ТЕСТ)`)
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

    if (broadcastAll)     return true
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

  let sent          = 0   // все включая ТЕСТ (для лога)
  let sentNonTest   = 0   // без ТЕСТ (для отчёта)
  let errorsNonTest = 0
  const sentByTariff = {}  // { 'БАЗА': N, 'ПРАКТИКА': N, ... } без ТЕСТ

  for (const member of targets) {
    const tgId   = String(member.fields['telegram_id'])
    const isTEST = member.fields['Тариф'] === 'ТЕСТ'
    let messageText = text

    if (is24hWebinar) {
      const baseUrl = broadcastBase
        ? process.env.ALLPAY_LINK_BASE
        : process.env.ALLPAY_LINK_PRACTICE
      console.log('[Webinar] baseUrl for', tariff, '=', baseUrl)
      const paymentUrl = buildPaymentUrl(baseUrl, {
        clientName:  member.fields['Имя, фамилия'] || '',
        clientEmail: member.fields['Электронная почта '] || '',
        telegramId:  member.fields['telegram_id'],
      })
      // Функция-replacer, а не строка: в URL могут быть $-последовательности ($&, $1),
      // которые String.replace трактует как ссылки на группы.
      messageText = text.replace(
        /₪: 👉 <a href="https?:\/\/[^"]*">[^<]*<\/a>/,
        () => `₪: 👉 <a href="${escapeHtmlAttr(paymentUrl)}">Оплатить</a>`
      )
    }

    try {
      await bot.telegram.sendMessage(tgId, messageText, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      })
      sent++
      if (!isTEST) {
        sentNonTest++
        const t = member.fields['Тариф'] || '?'
        sentByTariff[t] = (sentByTariff[t] || 0) + 1
      }
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

  // Отчёт для ТЕСТ-участников после каждой рассылки
  const testTargets = targets.filter(m => m.fields['Тариф'] === 'ТЕСТ')
  if (testTargets.length > 0) {
    const lines = Object.entries(sentByTariff)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, n]) => `${t}: ${n}`)
      .join('\n')
    const label = tariff || 'ВСЕ'
    const report =
      `📊 Отчёт рассылки [${label}]:\n` +
      `${lines || '—'}\n` +
      `Ошибок: ${errorsNonTest}`
    for (const m of testTargets) {
      try {
        await bot.telegram.sendMessage(String(m.fields['telegram_id']), report)
        console.log(`[Scheduler ${SCHEDULER_ID}] ТЕСТ report [${label}] sent to ${m.fields['telegram_id']}`)
      } catch (e) {
        console.error(`[Scheduler ${SCHEDULER_ID}] Failed to send ТЕСТ report to ${m.fields['telegram_id']}:`, e.message)
      }
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

  console.log(`[Scheduler ${SCHEDULER_ID}] Overdue messages (skip + clearSendFlag):`, overdueMessages.length)
  console.log(`[Scheduler ${SCHEDULER_ID}] Future messages (schedule setTimeout):`, futureMessages.length)

  futureMessages.forEach(({ msg, sendMoment }) => {
    const delay = sendMoment.diff(moment.tz('Asia/Jerusalem'))
    console.log(`  - Will send at: ${sendMoment.format('DD.MM HH:mm')} in ${Math.round(delay / 60000)} minutes`)
  })

  for (const msg of overdueMessages) {
    const t = msg.fields['Тариф'] || 'none'
    const ts = msg.fields['Время рассылки'] || 'no time'
    console.log(`[Scheduler ${SCHEDULER_ID}] Skipping overdue message: ${t} ${ts}`)
    try {
      await clearSendFlag(msg.id)
    } catch (e) {
      console.error(`[Scheduler ${SCHEDULER_ID}] clearSendFlag failed for overdue ${msg.id}:`, e.message)
    }
  }

  for (const { msg, sendMoment } of futureMessages) {
    const delay = sendMoment.diff(moment.tz('Asia/Jerusalem'))
    const timeoutId = setTimeout(() => sendBroadcast(bot, msg), delay)
    scheduledTimeouts.set(msg.id, timeoutId)
    console.log(`[Scheduler ${SCHEDULER_ID}] Scheduled timeout for message:`, msg.id)
  }
}

export function startScheduler(bot) {
  console.log(`[Scheduler ${SCHEDULER_ID}] Started — running scheduleCheck once on startup`)
  checkScheduledMessages(bot)
}

export async function forceSendPending(bot) {
  let messages
  try {
    messages = await getMessages()
  } catch (e) {
    console.error(`[Scheduler] forceSendPending: getMessages failed:`, e.message)
    throw e
  }
  const pending = messages.filter(m => m.fields['send'] === true)
  console.log(`[Scheduler] forceSendPending: found ${pending.length} pending messages`)
  for (const msg of pending) {
    await sendBroadcast(bot, msg)
  }
  return pending.length
}

// Алиас для явного вызова при рестарте
export { checkScheduledMessages as scheduleCheck }
