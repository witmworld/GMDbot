import { Scenes, Markup } from 'telegraf'
import { createPaymentLink } from '../integrations/allpay.js'

export const adminPaymentLinkScene = new Scenes.BaseScene('ADMIN_PAYMENT_LINK')

const cancelKeyboard = Markup.inlineKeyboard([[Markup.button.callback('❌ Отменить', 'payment_link:cancel')]])

// Шаг 1: Вход в сцену — запрос названия
adminPaymentLinkScene.enter(async (ctx) => {
  ctx.session.paymentLinkStep = 1
  ctx.session.paymentLinkData = {}

  await ctx.reply(
    '💳 *Создание ссылки на оплату*\n\nШаг 1/3: Введите название платежа:',
    { parse_mode: 'Markdown', ...cancelKeyboard }
  )
})

// Обработка текста
adminPaymentLinkScene.on('text', async (ctx) => {
  const step = ctx.session.paymentLinkStep

  if (step === 1) {
    ctx.session.paymentLinkData.title = ctx.message.text
    ctx.session.paymentLinkStep = 2

    await ctx.reply(
      '💳 *Создание ссылки на оплату*\n\nШаг 2/3: Введите сумму (в шекелях):',
      { parse_mode: 'Markdown', ...cancelKeyboard }
    )

  } else if (step === 2) {
    const amount = parseFloat(ctx.message.text)
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('❌ Некорректная сумма. Введите число больше 0:')
    }

    ctx.session.paymentLinkData.amount = amount
    ctx.session.paymentLinkStep = 3

    await ctx.reply(
      '💳 *Создание ссылки на оплату*\n\nШаг 3/3: Введите ссылку для редиректа после оплаты (success\\_url):\n\n_Отправьте `-` или `пропустить` чтобы не указывать_',
      { parse_mode: 'Markdown', ...cancelKeyboard }
    )

  } else if (step === 3) {
    const input = ctx.message.text.trim().toLowerCase()
    const skip = input === '-' || input === 'пропустить'
    ctx.session.paymentLinkData.successUrl = skip ? null : ctx.message.text.trim()

    try {
      await ctx.reply('⏳ Создаю ссылку на оплату...')

      const orderId = 'ADM_' + Date.now()
      const { title, amount, successUrl } = ctx.session.paymentLinkData

      const paymentUrl = await createPaymentLink({
        orderId,
        amount,
        description: title,
        ...(successUrl ? { successUrl } : {})
      })

      ctx.session.paymentLinkData.url = paymentUrl
      ctx.session.paymentLinkData.orderId = orderId

      await ctx.reply(
        `✅ Ссылка создана!\n\n` +
        `📝 Название: ${title}\n` +
        `💰 Сумма: ₪${amount}\n` +
        (successUrl ? `↩️ После оплаты: ${successUrl}\n` : '') +
        `\n🔗 Ссылка:\n${paymentUrl}`,
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📤 Разослать участникам', 'payment_link:broadcast')],
            [Markup.button.callback('✅ Готово', 'payment_link:done')]
          ])
        }
      )
    } catch (err) {
      console.error('[Payment Link] Error:', err)
      await ctx.reply('❌ Ошибка при создании ссылки: ' + err.message)
    }
  }
})

// Рассылка
adminPaymentLinkScene.action('payment_link:broadcast', async (ctx) => {
  await ctx.answerCbQuery()
  const { title, amount, url } = ctx.session.paymentLinkData
  ctx.session.broadcastData = {
    messages: [{
      text: `💳 ${title}\n💰 ₪${amount}\n\n🔗 ${url}`,
      extra: {}
    }]
  }
  return ctx.scene.enter('BROADCAST_SELECT')
})

// Готово
adminPaymentLinkScene.action('payment_link:done', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('✅ Готово!')
  return ctx.scene.enter('ADMIN_MENU')
})

// Отмена
adminPaymentLinkScene.action('payment_link:cancel', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('❌ Отменено')
  return ctx.scene.enter('ADMIN_MENU')
})
