import { Scenes, Markup } from 'telegraf'
import moment from 'moment-timezone'
import { isAdmin } from '../utils/adminCheck.js'
import { createCoupon, findCouponByCode } from '../integrations/fillout.js'

// Публичное имя бота для deep link — не секрет, тот же паттерн что
// ALLPAY_LINK_BASE в integrations/allpay.js: env необязательный переопределитель.
const BOT_USERNAME = process.env.BOT_USERNAME || 'GMD_club_bot'

// Похожие символы (O/0, I/1, L) исключены — код читают и вводят вручную.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
const MAX_CODE_ATTEMPTS = 5

function generateCode() {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

async function generateUniqueCode() {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCode()
    const existing = await findCouponByCode(code)
    if (!existing) return code
  }
  return null
}

export const adminCouponScene = new Scenes.BaseScene('ADMIN_COUPON')

const cancelKeyboard = Markup.inlineKeyboard([[Markup.button.callback('❌ Отменить', 'coupon:cancel')]])

// ── Вход в сцену ──────────────────────────────────────────────────────────────

adminCouponScene.enter(async (ctx) => {
  const admin = await isAdmin(ctx.from.id)
  if (!admin) {
    await ctx.reply('❌ У вас нет доступа к этому разделу')
    return ctx.scene.leave()
  }

  ctx.session.couponStep = 'discount'
  ctx.session.couponData = {}

  await ctx.reply(
    '🎟 <b>Создание купона</b>\n\nШаг 1/3: Выберите скидку:',
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('25%', 'coupon:discount:25'),
          Markup.button.callback('50%', 'coupon:discount:50'),
          Markup.button.callback('100%', 'coupon:discount:100'),
        ],
        [Markup.button.callback('✏️ Другая', 'coupon:discount:custom')],
        [Markup.button.callback('❌ Отменить', 'coupon:cancel')],
      ]),
    }
  )
})

// ── Текстовый ввод (только шаг "Другая" скидка) ─────────────────────────────────

adminCouponScene.on('text', async (ctx) => {
  const step = ctx.session.couponStep

  if (step !== 'discount_custom') {
    return ctx.reply('Пожалуйста, используйте кнопки выше ⬆️')
  }

  const n = Number(ctx.message.text.trim())
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    return ctx.reply('❌ Введите целое число от 1 до 100:', { ...cancelKeyboard })
  }

  ctx.session.couponData.discount = n
  ctx.session.couponStep = 'period'
  return showPeriodStep(ctx)
})

// ── Хелперы отображения ───────────────────────────────────────────────────────

async function showPeriodStep(ctx) {
  await ctx.reply(
    '📅 <b>Создание купона</b>\n\nШаг 2/3: Выберите период:',
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Месяц', 'coupon:period:month')],
        [Markup.button.callback('3 месяца', 'coupon:period:3months')],
        [Markup.button.callback('Полгода', 'coupon:period:half')],
        [Markup.button.callback('Год', 'coupon:period:year')],
        [Markup.button.callback('❌ Отменить', 'coupon:cancel')],
      ]),
    }
  )
}

async function showExpiryStep(ctx) {
  await ctx.reply(
    '⏳ <b>Создание купона</b>\n\nШаг 3/3: Выберите срок годности купона:',
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('30 дней', 'coupon:expiry:d30')],
        [Markup.button.callback('90 дней', 'coupon:expiry:d90')],
        [Markup.button.callback('До конца года', 'coupon:expiry:eoy')],
        [Markup.button.callback('❌ Отменить', 'coupon:cancel')],
      ]),
    }
  )
}

async function showPreview(ctx) {
  const d = ctx.session.couponData
  await ctx.reply(
    `📋 <b>Проверьте параметры купона:</b>\n\n` +
    `💰 Скидка: ${d.discount}%\n` +
    `📅 Период: ${d.period}\n` +
    `⏳ Действует до: ${d.expiryDate}`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Создать', 'coupon:create')],
        [Markup.button.callback('❌ Отмена', 'coupon:cancel')],
      ]),
    }
  )
}

// ── Шаг 1: скидка (пресеты) ───────────────────────────────────────────────────

adminCouponScene.action(/^coupon:discount:(25|50|100)$/, async (ctx) => {
  await ctx.answerCbQuery()
  ctx.session.couponData.discount = Number(ctx.match[1])
  ctx.session.couponStep = 'period'
  return showPeriodStep(ctx)
})

adminCouponScene.action('coupon:discount:custom', async (ctx) => {
  await ctx.answerCbQuery()
  ctx.session.couponStep = 'discount_custom'
  await ctx.reply('Введите скидку числом (целое от 1 до 100):', { ...cancelKeyboard })
})

// ── Шаг 2: период ─────────────────────────────────────────────────────────────

const PERIOD_LABELS = {
  month:   'Месяц',
  '3months': '3 месяца',
  half:    'Полгода',
  year:    'Год',
}

adminCouponScene.action(/^coupon:period:(month|3months|half|year)$/, async (ctx) => {
  await ctx.answerCbQuery()
  ctx.session.couponData.period = PERIOD_LABELS[ctx.match[1]]
  ctx.session.couponStep = 'expiry'
  return showExpiryStep(ctx)
})

// ── Шаг 3: срок годности ──────────────────────────────────────────────────────

adminCouponScene.action(/^coupon:expiry:(d30|d90|eoy)$/, async (ctx) => {
  await ctx.answerCbQuery()
  const code = ctx.match[1]
  const now = moment.tz('Asia/Jerusalem')

  let expiryMoment
  if (code === 'd30') expiryMoment = now.clone().add(30, 'days')
  else if (code === 'd90') expiryMoment = now.clone().add(90, 'days')
  else expiryMoment = now.clone().endOf('year')

  ctx.session.couponData.expiryDate = expiryMoment.format('YYYY-MM-DD')
  ctx.session.couponStep = 'preview'
  return showPreview(ctx)
})

// ── Шаг 4: создание ───────────────────────────────────────────────────────────

adminCouponScene.action('coupon:create', async (ctx) => {
  await ctx.answerCbQuery()
  const d = ctx.session.couponData

  await ctx.reply('⏳ Создаю купон...')

  try {
    const code = await generateUniqueCode()
    if (!code) {
      await ctx.reply(`❌ Не удалось подобрать уникальный код за ${MAX_CODE_ATTEMPTS} попыток. Попробуйте ещё раз.`)
      return ctx.scene.enter('ADMIN_MENU')
    }

    const today = moment.tz('Asia/Jerusalem').format('YYYY-MM-DD')

    const created = await createCoupon({
      'Код':          code,
      'Скидка %':     d.discount,
      'Период':       d.period,
      'Действует до': d.expiryDate,
      'Создал':       ctx.from.id,
      'Active':       true,
      'Создан':       today,
    })
    console.log(`[Coupon] Created: ${code} | id: ${created?.id}`)

    const deepLink = `https://t.me/${BOT_USERNAME}?start=c-${code}`

    await ctx.reply(`<code>${code}</code>`, { parse_mode: 'HTML' })
    await ctx.reply(
      `✅ Купон создан!\n\n` +
      `💰 Скидка: ${d.discount}%\n` +
      `📅 Период: ${d.period}\n` +
      `⏳ Действует до: ${d.expiryDate}\n\n` +
      `🔗 Ссылка для клиента:\n${deepLink}`,
      { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
    )
  } catch (err) {
    console.error('[Coupon] Create error:', err)
    await ctx.reply('❌ Ошибка при создании купона: ' + err.message)
  }

  return ctx.scene.enter('ADMIN_MENU')
})

// ── Отмена ────────────────────────────────────────────────────────────────────

adminCouponScene.action('coupon:cancel', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('❌ Отменено')
  return ctx.scene.enter('ADMIN_MENU')
})
