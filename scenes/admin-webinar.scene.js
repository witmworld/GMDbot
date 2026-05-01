import { Scenes, Markup } from 'telegraf'
import moment from 'moment-timezone'
import { isAdmin } from '../utils/adminCheck.js'
import { createPaymentLink } from '../integrations/allpay.js'
import { createMessage } from '../integrations/fillout.js'

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
    // ── Платёжные ссылки ────────────────────────────────────────────────────
    const orderIdBase     = `webinar_base_${Date.now()}`
    const orderIdPractice = `webinar_practice_${Date.now() + 1}`

    const linkBase = await createPaymentLink({
      orderId: orderIdBase,
      amount:  d.priceBase,
      description: `Доступ на вебинар - БАЗА (${d.dateText})`,
    })
    console.log(`[Webinar] Payment link БАЗА: ${linkBase}`)

    const linkPractice = await createPaymentLink({
      orderId: orderIdPractice,
      amount:  d.pricePractice,
      description: `Запись вебинара - ПРАКТИКА (${d.dateText})`,
    })
    console.log(`[Webinar] Payment link ПРАКТИКА: ${linkPractice}`)

    // ── Текст анонса ─────────────────────────────────────────────────────────
    const announcementText =
      `🎓 *${d.title}*\n\n` +
      `📅 ${d.dateText}\n` +
      `🎤 Ведущий: ${d.speaker}\n\n` +
      `${d.description}\n\n` +
      `💳 Доступ для БАЗА: ${linkBase}\n` +
      `📹 Запись для ПРАКТИКА: ${linkPractice}`

    // ── Времена рассылки ──────────────────────────────────────────────────────
    const webinarMoment      = moment.tz(d.dateIso, 'Asia/Jerusalem')
    const announcementMoment = moment.tz(d.dateIso, 'Asia/Jerusalem').subtract(1, 'day').hour(10).minute(0).second(0).millisecond(0)
    const zoomReminderMoment = moment.tz(d.dateIso, 'Asia/Jerusalem').subtract(30, 'minutes')

    // ── Запись анонса в MESSAGE table ─────────────────────────────────────────
    await createMessage({
      text:     announcementText,
      tariff:   'КЛУБ',
      sendTime: announcementMoment.toISOString(),
      send:     true,
    })
    console.log(`[Webinar] Announcement message created, scheduled: ${announcementMoment.format('DD.MM HH:mm')}`)

    // ── Запись напоминания с Zoom (если ссылка есть) ──────────────────────────
    let recordsCreated = 1
    if (d.zoomUrl) {
      const zoomText =
        `🔔 Вебинар начинается через 30 минут!\n` +
        `*${d.title}*\n\n` +
        `🔗 Ссылка на Zoom: ${d.zoomUrl}`
      await createMessage({
        text:     zoomText,
        tariff:   'КЛУБ',
        sendTime: zoomReminderMoment.toISOString(),
        zoomUrl:  d.zoomUrl,
        send:     true,
      })
      console.log(`[Webinar] Zoom reminder created, scheduled: ${zoomReminderMoment.format('DD.MM HH:mm')}`)
      recordsCreated = 2
    }

    await ctx.reply(
      `✅ *Вебинар создан!*\n\n` +
      `📋 Записей в MESSAGE table: ${recordsCreated}\n` +
      `📅 Анонс уйдёт: ${announcementMoment.format('DD.MM в HH:mm')} (за день)\n` +
      (d.zoomUrl ? `🔔 Напоминание с Zoom: ${zoomReminderMoment.format('DD.MM в HH:mm')} (за 30 мин)\n\n` : '\n') +
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
