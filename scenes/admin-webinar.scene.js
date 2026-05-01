import { Scenes, Markup } from 'telegraf'
import moment from 'moment-timezone'
import { isAdmin } from '../utils/adminCheck.js'
import { createPaymentLink } from '../integrations/allpay.js'
import { createMessage, updateMessage, getMessages, getClubMembers } from '../integrations/fillout.js'

const DEFAULT_PRICE_BASE     = 50
const DEFAULT_PRICE_PRACTICE = 30

const MONTHS = {
  'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
  'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
}

function parseWebinarDate(text) {
  const match = text.trim().match(/^(\d{1,2})\s+(\S+)\s+(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const [, day, monthStr, hours, minutes] = match
  const month = MONTHS[monthStr.toLowerCase()]
  if (!month) return null
  const year = moment.tz('Asia/Jerusalem').year()
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(parseInt(day)).padStart(2, '0')} ${hours}:${minutes}`
  const m = moment.tz(dateStr, 'YYYY-MM-DD HH:mm', 'Asia/Jerusalem')
  return m.isValid() ? m : null
}

export const adminWebinarScene = new Scenes.BaseScene('ADMIN_WEBINAR')

const cancelKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('❌ Отменить', 'webinar:cancel')]
])

// ── Вход в сцену ──────────────────────────────────────────────────────────────

adminWebinarScene.enter(async (ctx) => {
  const admin = await isAdmin(ctx.from.id)
  if (!admin) {
    await ctx.reply('❌ У вас нет доступа к этому разделу')
    return ctx.scene.leave()
  }

  // ── zoom_only режим ───────────────────────────────────────────────────────
  if (ctx.session.webinarZoomOnly) {
    ctx.session.webinarStep = 'zoom_only'
    return ctx.reply(
      '🔗 *Добавить Zoom URL*\n\nВведите ссылку на Zoom:',
      { parse_mode: 'Markdown', ...cancelKeyboard }
    )
  }

  // ── обычный режим ─────────────────────────────────────────────────────────
  ctx.session.webinarStep = 1
  ctx.session.webinarData = {
    priceBase:     DEFAULT_PRICE_BASE,
    pricePractice: DEFAULT_PRICE_PRACTICE,
  }

  await ctx.reply(
    '📅 *Создание вебинара*\n\nШаг 1/6: Введите дату и время вебинара:\n_Например: 4 мая 19:00_',
    { parse_mode: 'Markdown', ...cancelKeyboard }
  )
})

// ── Текстовые шаги ────────────────────────────────────────────────────────────

adminWebinarScene.on('text', async (ctx) => {
  const step = ctx.session.webinarStep
  const data = ctx.session.webinarData

  // ── zoom_only: получить и применить Zoom URL ───────────────────────────────
  if (step === 'zoom_only') {
    const zoomUrl = ctx.message.text.trim()
    ctx.session.webinarZoomOnly = false

    await ctx.reply('⏳ Обновляю записи...')

    try {
      // Найти записи без ZOOM_URL с временем рассылки не старше 3 часов назад
      const messages = await getMessages()
      const now = Date.now()
      const toUpdate = messages.filter(m => {
        if (m.fields['ZOOM_URL']) return false
        const sendTimeStr = m.fields['Время рассылки']
        if (!sendTimeStr) return false
        const t = new Date(sendTimeStr).getTime()
        return t > now - 3 * 60 * 60 * 1000
      })

      for (const rec of toUpdate) {
        await updateMessage(rec.id, { 'ZOOM_URL': zoomUrl })
        console.log(`[Webinar Zoom] Updated record ${rec.id} (${rec.fields['Тариф']} @ ${rec.fields['Время рассылки']})`)
      }

      // Найти участников с активной оплатой (поле Вебинар ≤30 дней)
      const allMembers = await getClubMembers()
      const paidMembers = allMembers.filter(m => {
        const raw = m.fields['Вебинар']
        if (!raw) return false
        const [dd, mm, yyyy] = raw.split('/')
        if (!dd || !mm || !yyyy) return false
        const paid = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd))
        return (Date.now() - paid.getTime()) / (1000 * 60 * 60 * 24) <= 30
      })

      let sent = 0
      for (const member of paidMembers) {
        const tgId = member.fields['telegram_id']
        if (!tgId) continue
        try {
          await ctx.telegram.sendMessage(
            String(tgId),
            `🔗 Ссылка на вебинар готова!\n${zoomUrl}`,
            { link_preview_options: { is_disabled: true } }
          )
          sent++
        } catch (e) {
          console.error(`[Webinar Zoom] sendMessage failed for ${tgId}:`, e.message)
        }
      }

      await ctx.reply(
        `✅ Обновлено ${toUpdate.length} записей рассылки, отправлено ${sent} участникам с оплаченным доступом`
      )
    } catch (err) {
      console.error('[Webinar Zoom] Error:', err)
      await ctx.reply('❌ Ошибка: ' + err.message)
    }

    return ctx.scene.enter('ADMIN_MENU')
  }

  // ── Шаг 1: дата и время ───────────────────────────────────────────────────
  if (step === 1) {
    const m = parseWebinarDate(ctx.message.text)
    if (!m) {
      return ctx.reply('❌ Не могу распознать дату. Введите в формате _"4 мая 19:00"_:', { parse_mode: 'Markdown' })
    }
    data.dateText = ctx.message.text.trim()
    data.dateIso  = m.toISOString()
    ctx.session.webinarStep = 2
    return ctx.reply(
      '📝 *Создание вебинара*\n\nШаг 2/6: Введите заголовок вебинара:',
      { parse_mode: 'Markdown', ...cancelKeyboard }
    )
  }

  // ── Шаг 2: заголовок ──────────────────────────────────────────────────────
  if (step === 2) {
    data.title = ctx.message.text.trim()
    ctx.session.webinarStep = 3
    return ctx.reply(
      '🎤 *Создание вебинара*\n\nШаг 3/6: Введите имя ведущего:',
      { parse_mode: 'Markdown', ...cancelKeyboard }
    )
  }

  // ── Шаг 3: ведущий ────────────────────────────────────────────────────────
  if (step === 3) {
    data.speaker = ctx.message.text.trim()
    ctx.session.webinarStep = 4
    return ctx.reply(
      '📋 *Создание вебинара*\n\nШаг 4/6: Введите тему / описание (что узнают участники):',
      { parse_mode: 'Markdown', ...cancelKeyboard }
    )
  }

  // ── Шаг 4: описание ───────────────────────────────────────────────────────
  if (step === 4) {
    data.description = ctx.message.text.trim()
    ctx.session.webinarStep = 5
    return ctx.reply(
      '🔗 *Создание вебинара*\n\nШаг 5/6: Введите ссылку на Zoom:\n_Отправьте `-` если ссылки пока нет_',
      { parse_mode: 'Markdown', ...cancelKeyboard }
    )
  }

  // ── Шаг 5: Zoom URL ───────────────────────────────────────────────────────
  if (step === 5) {
    const input = ctx.message.text.trim()
    data.zoomUrl = input === '-' ? null : input
    ctx.session.webinarStep = 6
    return showPriceConfirm(ctx)
  }

  // ── Шаг 6: ввод изменённых цен ───────────────────────────────────────────
  if (step === 6) {
    const parts    = ctx.message.text.trim().split(/\s+/)
    const base     = parseFloat(parts[0])
    const practice = parseFloat(parts[1])
    if (isNaN(base) || isNaN(practice) || base <= 0 || practice <= 0) {
      return ctx.reply(
        '❌ Введите две суммы через пробел, например: `50 30`',
        { parse_mode: 'Markdown' }
      )
    }
    data.priceBase     = base
    data.pricePractice = practice
    ctx.session.webinarStep = 7
    return showPreview(ctx)
  }
})

// ── Хелперы отображения ───────────────────────────────────────────────────────

async function showPriceConfirm(ctx) {
  const data = ctx.session.webinarData
  await ctx.reply(
    `💰 *Шаг 6/6 — Суммы доплат:*\n\n` +
    `• Доступ для БАЗА: ₪${data.priceBase}\n` +
    `• ПРАКТИКА (запись): ₪${data.pricePractice}\n\n` +
    `Подтвердить или ввести новые суммы?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Подтвердить', 'webinar:prices_ok')],
        [Markup.button.callback('✏️ Изменить', 'webinar:prices_edit')],
        [Markup.button.callback('❌ Отменить', 'webinar:cancel')],
      ])
    }
  )
}

async function showPreview(ctx) {
  const d = ctx.session.webinarData
  await ctx.reply(
    `📋 *Проверьте данные вебинара:*\n\n` +
    `📅 Дата: ${d.dateText}\n` +
    `📝 Заголовок: ${d.title}\n` +
    `🎤 Ведущий: ${d.speaker}\n` +
    `📋 Описание: ${d.description}\n` +
    `🔗 Zoom: ${d.zoomUrl || 'не указан'}\n` +
    `💰 Доступ БАЗА: ₪${d.priceBase}\n` +
    `💰 Запись ПРАКТИКА: ₪${d.pricePractice}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Создать', 'webinar:confirm')],
        [Markup.button.callback('❌ Отмена',  'webinar:cancel')],
      ])
    }
  )
}

// ── Inline-кнопки ─────────────────────────────────────────────────────────────

adminWebinarScene.action('webinar:prices_ok', async (ctx) => {
  await ctx.answerCbQuery()
  ctx.session.webinarStep = 7
  return showPreview(ctx)
})

adminWebinarScene.action('webinar:prices_edit', async (ctx) => {
  await ctx.answerCbQuery()
  ctx.session.webinarStep = 6
  const d = ctx.session.webinarData
  await ctx.reply(
    `✏️ Введите новые суммы через пробел:\n` +
    `_Сначала БАЗА, потом ПРАКТИКА. Например: \`${d.priceBase} ${d.pricePractice}\`_`,
    { parse_mode: 'Markdown', ...cancelKeyboard }
  )
})

adminWebinarScene.action('webinar:confirm', async (ctx) => {
  await ctx.answerCbQuery()
  const d = ctx.session.webinarData

  await ctx.reply('⏳ Создаю вебинар...')

  try {
    // ── Платёжные ссылки ─────────────────────────────────────────────────────
    const orderIdBase     = `webinar_base_${Date.now()}`
    const orderIdPractice = `webinar_practice_${Date.now() + 1}`

    const linkBase = await createPaymentLink({
      orderId:     orderIdBase,
      amount:      d.priceBase,
      description: `Доступ на вебинар - БАЗА (${d.dateText})`,
    })
    console.log(`[Webinar] Payment link БАЗА: ${linkBase}`)

    const linkPractice = await createPaymentLink({
      orderId:     orderIdPractice,
      amount:      d.pricePractice,
      description: `Запись вебинара - ПРАКТИКА (${d.dateText})`,
    })
    console.log(`[Webinar] Payment link ПРАКТИКА: ${linkPractice}`)

    // ── Вспомогательные переменные ───────────────────────────────────────────
    const dateMatch = d.dateText.match(/^(.+)\s+(\d{1,2}:\d{2})$/)
    const datePart  = dateMatch ? dateMatch[1] : d.dateText   // "4 мая"
    const timePart  = dateMatch ? dateMatch[2] : ''           // "19:00"

    const zoom           = d.zoomUrl
    const zoomLine       = zoom ? `Ссылка на Zoom: ${zoom}\n` : ''
    const zoomOrLater    = zoom || 'придёт позже'
    const zoomOrContact  = zoom || 'уточните у @where_is_themoney'

    // ── Времена рассылки ──────────────────────────────────────────────────────
    const t24h = moment.tz(d.dateIso, 'Asia/Jerusalem').subtract(24, 'hours')
    const t1h  = moment.tz(d.dateIso, 'Asia/Jerusalem').subtract(1, 'hour')
    const t15m = moment.tz(d.dateIso, 'Asia/Jerusalem').subtract(15, 'minutes')

    // ── Тексты сообщений ──────────────────────────────────────────────────────

    // БАЗА [-24h] × 1
    const textBase24 =
      `Привет! 👋 Завтра, ${datePart} в ${timePart} — вебинар «${d.title}» с ${d.speaker}. ` +
      `${d.description} ` +
      `Хотите присоединиться онлайн или получить запись — доплата ${d.priceBase}₪: 👉 ${linkBase} ` +
      `${zoomLine}` +
      `Есть вопросы? Пишите @where_is_themoney`

    // ПРАКТИКА [-24h]
    const textPractice24 =
      `Привет! 👋 Завтра, ${datePart} в ${timePart} — вебинар «${d.title}» с ${d.speaker}. ` +
      `${d.description} ` +
      `Запись в ваш тариф не входит, но можно исправить — ${d.pricePractice}₪: 👉 ${linkPractice} ` +
      `${zoomLine}` +
      `Есть вопросы? Пишите @where_is_themoney`

    // ПРАКТИКА [-1h]
    const textPractice1h =
      `Привет! Через час — вебинар «${d.title}» с ${d.speaker}. ` +
      `Запись не входит в ваш тариф — ${d.pricePractice}₪: 👉 ${linkPractice} ` +
      `Ссылка на Zoom: ${zoomOrLater} ` +
      `Есть вопросы? Пишите @where_is_themoney`

    // ПРАКТИКА [-15min]
    const textPractice15m =
      `Через 15 минут начинаем! 🎙 «${d.title}» с ${d.speaker}. ` +
      `Ссылка на Zoom: ${zoomOrContact} ` +
      `Запись — ${d.pricePractice}₪: 👉 ${linkPractice}`

    // ДОСТУП [-24h]
    const textAccess24 =
      `Привет! 👋 Завтра, ${datePart} в ${timePart} — вебинар «${d.title}» с ${d.speaker}. ` +
      `${d.description} ` +
      `${zoomLine}` +
      `Есть вопросы? Пишите @where_is_themoney`

    // ДОСТУП [-1h]
    const textAccess1h =
      `Привет! Через час — вебинар «${d.title}» с ${d.speaker}. ` +
      `Ссылка на Zoom: ${zoomOrLater} ` +
      `Есть вопросы? Пишите @where_is_themoney`

    // ДОСТУП [-15min]
    const textAccess15m =
      `Через 15 минут начинаем! 🎙 «${d.title}» с ${d.speaker}. ` +
      `Ссылка на Zoom: ${zoomOrContact}`

    // ── Создание записей в MESSAGE table (7 штук) ─────────────────────────────
    const records = [
      // БАЗА: 1 запись
      { text: textBase24,     tariff: 'БАЗА',      sendTime: t24h.toISOString(), zoomUrl: zoom },

      // ПРАКТИКА: 3 записи
      { text: textPractice24, tariff: 'ПРАКТИКА',  sendTime: t24h.toISOString(), zoomUrl: zoom },
      { text: textPractice1h, tariff: 'ПРАКТИКА',  sendTime: t1h.toISOString(),  zoomUrl: zoom },
      { text: textPractice15m,tariff: 'ПРАКТИКА',  sendTime: t15m.toISOString(), zoomUrl: zoom },

      // ДОСТУП: 3 записи
      { text: textAccess24,   tariff: 'ДОСТУП',    sendTime: t24h.toISOString(), zoomUrl: zoom },
      { text: textAccess1h,   tariff: 'ДОСТУП',    sendTime: t1h.toISOString(),  zoomUrl: zoom },
      { text: textAccess15m,  tariff: 'ДОСТУП',    sendTime: t15m.toISOString(), zoomUrl: zoom },
    ]

    for (const rec of records) {
      await createMessage({
        text:     rec.text,
        tariff:   rec.tariff,
        sendTime: rec.sendTime,
        zoomUrl:  rec.zoomUrl || null,
        send:     true,
      })
      console.log(`[Webinar] Created: ${rec.tariff} @ ${moment.tz(rec.sendTime, 'Asia/Jerusalem').format('DD.MM HH:mm')}`)
    }

    await ctx.reply(
      `✅ *Вебинар создан!*\n\n` +
      `📋 Записей в MESSAGE table: 7\n\n` +
      `⏰ Расписание рассылок:\n` +
      `• ${t24h.tz('Asia/Jerusalem').format('DD.MM в HH:mm')} — за 24ч (БАЗА, ПРАКТИКА, ДОСТУП)\n` +
      `• ${t1h.tz('Asia/Jerusalem').format('DD.MM в HH:mm')} — за 1ч (ПРАКТИКА, ДОСТУП)\n` +
      `• ${t15m.tz('Asia/Jerusalem').format('DD.MM в HH:mm')} — за 15мин (ПРАКТИКА, ДОСТУП)\n\n` +
      `🔗 Ссылка БАЗА: ${linkBase}\n` +
      `📹 Ссылка ПРАКТИКА: ${linkPractice}`,
      { parse_mode: 'Markdown' }
    )
  } catch (err) {
    console.error('[Webinar] Create error:', err)
    await ctx.reply('❌ Ошибка при создании вебинара: ' + err.message)
  }

  return ctx.scene.enter('ADMIN_MENU')
})

adminWebinarScene.action('webinar:cancel', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('❌ Отменено')
  return ctx.scene.enter('ADMIN_MENU')
})
