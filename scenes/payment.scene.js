import { Scenes, Markup } from 'telegraf'
import { handleBack } from './nav.js'
import { createPayment } from '../integrations/allpay.js'
import { updateLead } from '../integrations/bitrix.js'
import { handleGlobalCallbacks } from '../ui/handlers.js'
import { getTariffs } from '../integrations/fillout.js'

export const paymentScene = new Scenes.BaseScene('PAYMENT')

function generateOrderId(ctx) {
  return `${ctx.from.id}_${Date.now()}`
}

// Локальная копия, а не импорт из confirm.scene.js — держим этот коммит
// независимым от файла, который целиком меняется в купонном коммите.
async function findTariffAmount(tariffName, term) {
  const tariffs = await getTariffs()
  const match = tariffs.find(t => t.name === tariffName && t.term === term)
  return match?.amount ?? null
}

paymentScene.enter(async (ctx) => {
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
