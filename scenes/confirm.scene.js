import { Scenes } from 'telegraf'
import moment from 'moment-timezone'
import { handleBack } from './nav.js'
import { createOrUpdateBitrixLead } from '../integrations/bitrix.js'
import { Keyboards } from '../ui/keyboards.js'
import { handleGlobalCallbacks } from '../ui/handlers.js'
import { getTariffs, getClubMemberRecord, findCouponByCode } from '../integrations/fillout.js'

export const confirmScene = new Scenes.BaseScene('CONFIRM')

// Купон переводит покупку на месяц независимо от выбранного на PERIOD срока —
// цена всегда ищется по этому term, а не по ctx.session.period.
const MONTH_TERM = 'Месяц'

// Экспортируется — payment.scene.js использует ровно ту же функцию,
// а не собственный расчёт по TARIFFS_DATA (см. utils/tariffPayment.js note).
export async function findTariffAmount(tariffName, term) {
  const tariffs = await getTariffs()
  const match = tariffs.find(t => t.name === tariffName && t.term === term)
  return match?.amount ?? null
}

async function showConfirm(ctx) {
  let amount = ''
  try {
    const a = await findTariffAmount(ctx.session.tariffName, ctx.session.period)
    if (a != null) amount = `\nСумма: ${a} ₪`
  } catch (e) {
    console.error('[confirm] Ошибка загрузки суммы:', e.message)
  }

  await ctx.reply(
    `Проверь данные:\n\nТариф: ${ctx.session.tariffName}\nПериод: ${ctx.session.period}${amount}\n\nЕсли всё верно — подтвердите и перейдём к оплате.`,
    {
      reply_markup: Keyboards.confirmMenu()
    }
  )
}

async function proceedToPayment(ctx) {
  try {
    await createOrUpdateBitrixLead(ctx)
  } catch (err) {
    console.error('❌ Ошибка Bitrix:', err)
    await ctx.reply('Произошла ошибка при сохранении данных. Попробуйте позже.')
    return
  }

  await ctx.reply('✅ Отлично! Данные сохранены.\n\nПереходим к оплате...')
  await ctx.scene.enter('PAYMENT')
}

async function showCouponPreview(ctx) {
  const c = ctx.session.appliedCoupon
  await ctx.reply(
    `🎟 <b>Купон ${c.code} применён</b>\n\n` +
    `Было: ${c.originalAmount} ₪ / месяц\n` +
    `Скидка: ${c.discountPercent}%\n` +
    `Стало: <b>${c.newAmount} ₪ / месяц</b>\n\n` +
    `Тариф переходит на помесячную оплату независимо от ранее выбранного периода.`,
    {
      parse_mode: 'HTML',
      reply_markup: Keyboards.couponPreviewMenu()
    }
  )
}

confirmScene.enter(async (ctx) => {
  ctx.session.awaitingCouponCode = false
  ctx.session.appliedCoupon = null
  return showConfirm(ctx)
})

// ── Ввод кода купона текстом ─────────────────────────────────────────────────

confirmScene.on('text', async (ctx) => {
  if (!ctx.session.awaitingCouponCode) return

  ctx.session.awaitingCouponCode = false
  const code = ctx.message.text.trim().toUpperCase()

  try {
    const coupon = await findCouponByCode(code)

    if (!coupon) {
      await ctx.reply('❌ Купон с таким кодом не найден.')
      return showConfirm(ctx)
    }

    if (coupon.fields['Active'] !== true) {
      await ctx.reply('❌ Этот купон уже неактивен.')
      return showConfirm(ctx)
    }

    const today = moment.tz('Asia/Jerusalem').format('YYYY-MM-DD')
    if (!coupon.fields['Действует до'] || coupon.fields['Действует до'] < today) {
      await ctx.reply('❌ Срок действия купона истёк.')
      return showConfirm(ctx)
    }

    const member = await getClubMemberRecord(ctx.from.id)
    const usedCodes = (member?.fields['COUPON'] || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    if (usedCodes.includes(code)) {
      await ctx.reply('❌ Вы уже использовали этот купон.')
      return showConfirm(ctx)
    }

    const originalAmount = await findTariffAmount(ctx.session.tariffName, MONTH_TERM)
    if (originalAmount == null) {
      await ctx.reply('❌ Не удалось определить цену тарифа для купона. Попробуйте позже.')
      return showConfirm(ctx)
    }

    const discountPercent = coupon.fields['Скидка %']
    const newAmount = Math.round(originalAmount * (100 - discountPercent) / 100)

    ctx.session.appliedCoupon = { code, discountPercent, originalAmount, newAmount }
    return showCouponPreview(ctx)
  } catch (err) {
    console.error('[Coupon] Validation error:', err)
    await ctx.reply('❌ Не удалось проверить купон. Попробуйте позже.')
    return showConfirm(ctx)
  }
})

// ── Callback-кнопки ───────────────────────────────────────────────────────────

confirmScene.on('callback_query', async (ctx) => {
  if (await handleGlobalCallbacks(ctx)) return
  if (await handleBack(ctx)) return

  const data = ctx.callbackQuery.data

  if (data === 'confirm:ok') {
    await ctx.answerCbQuery()
    return proceedToPayment(ctx)
  }

  if (data === 'confirm:coupon') {
    await ctx.answerCbQuery()
    ctx.session.awaitingCouponCode = true
    await ctx.reply('Введите код купона:', {
      reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'back:CONFIRM' }]] }
    })
    return
  }

  if (data === 'confirm:coupon_apply') {
    await ctx.answerCbQuery()
    return proceedToPayment(ctx)
  }

  if (data === 'confirm:coupon_decline') {
    await ctx.answerCbQuery()
    ctx.session.appliedCoupon = null
    return showConfirm(ctx)
  }
})
