import { Scenes, Markup } from 'telegraf'
import { handleBack } from './nav.js'
import { createPayment } from '../integrations/allpay.js'
import { updateLead } from '../integrations/bitrix.js'
import { TARIFFS_DATA } from '../content/tariffs.data.js'
import { handleGlobalCallbacks } from '../ui/handlers.js'

export const paymentScene = new Scenes.BaseScene('PAYMENT')

function generateOrderId(ctx) {
  return `${ctx.from.id}_${Date.now()}`
}

function getAmount(tariffCode, period) {
  const tariff = TARIFFS_DATA[tariffCode]
  if (!tariff) return null
  return period === 'year' ? tariff.price_year : tariff.price_month
}

paymentScene.enter(async (ctx) => {
  const tariffCode = ctx.session.tariff
  const period = ctx.session.period
  const tariff = TARIFFS_DATA[tariffCode]

  if (!tariff) {
    await ctx.reply('Тариф не найден. Попробуй выбрать заново.')
    return ctx.scene.enter('TARIFF')
  }

  const amount = getAmount(tariffCode, period)
  const orderId = generateOrderId(ctx)
  const periodLabel = period === 'year' ? 'год' : 'месяц'

  ctx.session.orderId = orderId

  try {
    if (ctx.session.bitrixLeadId) {
      await updateLead(ctx.session.bitrixLeadId, ctx)
    }

    const result = await createPayment({
      orderId,
      amount,
      description: `${tariff.title} — ${periodLabel}`,
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
      `Тариф: ${tariff.title}\n` +
      `Период: ${periodLabel}\n` +
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
