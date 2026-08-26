import { Scenes, Markup } from 'telegraf'
import { handleBack } from './nav.js'
import { createPayment } from '../integrations/allpay.js'
import { updateLead } from '../integrations/bitrix.js'
import { handleGlobalCallbacks } from '../ui/handlers.js'
import { processTariffPayment } from '../utils/tariffPayment.js'
import { findTariffAmount } from './confirm.scene.js'

export const paymentScene = new Scenes.BaseScene('PAYMENT')

function generateOrderId(ctx) {
  return `${ctx.from.id}_${Date.now()}`
}

async function enterWithCoupon(ctx) {
  const coupon = ctx.session.appliedCoupon
  const orderId = generateOrderId(ctx)
  const description = `${ctx.session.tariffName} — месяц — купон ${coupon.code}`

  ctx.session.orderId = orderId

  if (ctx.session.bitrixLeadId) {
    try {
      await updateLead(ctx.session.bitrixLeadId, ctx)
    } catch (err) {
      console.error('❌ Ошибка Bitrix (купон):', err)
    }
  }

  // Скидка 100% — оплаты нет вовсе, запускаем постоплатную цепочку напрямую.
  if (coupon.newAmount <= 0) {
    const body = {
      status: '1',
      order_id: orderId,
      add_field: String(ctx.from.id),
      amount: 0,
      name: description,
      client_name: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim(),
      client_email: ctx.session.email || '',
      client_phone: ctx.session.phone || '',
    }

    try {
      await processTariffPayment(ctx.telegram, body)
      ctx.session.appliedCoupon = null
      await ctx.reply(
        `✅ Купон применён на 100%!\n\n` +
        `Тариф: ${ctx.session.tariffName}\n` +
        `Период: месяц\n\n` +
        `Подписка активирована, оплата не требуется.`
      )
    } catch (err) {
      console.error('❌ Ошибка активации по купону 100%:', err)
      await ctx.reply('Произошла ошибка при активации подписки. Попробуй позже или напиши в поддержку.')
    }
    return
  }

  // Скидка < 100% — обычный путь через AllPay с новой суммой.
  try {
    const result = await createPayment({
      orderId,
      amount: coupon.newAmount,
      description,
      customerPhone: ctx.session.phone,
      customerEmail: ctx.session.email
    })

    const payUrl = result.payment_url
    if (!payUrl) {
      console.error('AllPay: нет ссылки на оплату (купон)', result)
      await ctx.reply('Не удалось создать платёж. Попробуй позже.')
      return
    }

    console.log(`Payment created (coupon ${coupon.code}): ${orderId}`)

    await ctx.reply(
      `Заказ создан!\n\n` +
      `Тариф: ${ctx.session.tariffName}\n` +
      `Период: месяц\n` +
      `Сумма со скидкой: ${coupon.newAmount} ₪ (было ${coupon.originalAmount} ₪)\n\n` +
      `Нажми кнопку ниже для оплаты 👇`,
      Markup.inlineKeyboard([
        [Markup.button.url('💳 Оплатить', payUrl)],
        [{ text: '⬅️ Назад', callback_data: 'back:CONFIRM' }]
      ])
    )
  } catch (err) {
    console.error('❌ Ошибка AllPay (купон):', err)
    await ctx.reply('Произошла ошибка при создании платежа. Попробуй позже.')
  }
}

paymentScene.enter(async (ctx) => {
  if (ctx.session.appliedCoupon) {
    return enterWithCoupon(ctx)
  }

  const tariffName = ctx.session.tariffName
  const period = ctx.session.period

  const amount = await findTariffAmount(tariffName, period)

  if (amount == null) {
    await ctx.reply('Тариф не найден. Попробуй выбрать заново.')
    return ctx.scene.enter('TARIFF')
  }

  const orderId = generateOrderId(ctx)

  ctx.session.orderId = orderId

  try {
    if (ctx.session.bitrixLeadId) {
      await updateLead(ctx.session.bitrixLeadId, ctx)
    }

    const result = await createPayment({
      orderId,
      amount,
      description: `${tariffName} — ${period}`,
      customerPhone: ctx.session.phone,
      customerEmail: ctx.session.email
    })

    const payUrl = result.payment_url
    if (!payUrl) {
      console.error('AllPay: нет ссылки на оплату', result)
      await ctx.reply('Не удалось создать платёж. Попробуй позже.')
      return
    }

    console.log(`Payment created: ${orderId}`)

    await ctx.reply(
      `Заказ создан!\n\n` +
      `Тариф: ${tariffName}\n` +
      `Период: ${period}\n` +
      `Сумма: ${amount} ₪\n\n` +
      `Нажми кнопку ниже для оплаты 👇`,
      Markup.inlineKeyboard([
        [Markup.button.url('💳 Оплатить', payUrl)],
        [{ text: '⬅️ Назад', callback_data: 'back:CONFIRM' }]
      ])
    )
  } catch (err) {
    console.error('❌ Ошибка AllPay:', err)
    await ctx.reply('Произошла ошибка при создании платежа. Попробуй позже.')
  }
})

paymentScene.on('callback_query', async (ctx) => {
  if (await handleGlobalCallbacks(ctx)) return
  if (await handleBack(ctx)) return
})
