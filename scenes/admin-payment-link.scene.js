import { Scenes, Markup } from 'telegraf'
import { createPaymentLink } from '../integrations/allpay.js'

export const adminPaymentLinkScene = new Scenes.BaseScene('ADMIN_PAYMENT_LINK')

// Шаг 1: Вход в сцену — запрос названия
adminPaymentLinkScene.enter(async (ctx) => {
  ctx.session.paymentLinkStep = 1
  ctx.session.paymentLinkData = {}

  await ctx.reply(
    '💳 *Создание ссылки на оплату*\n\nШаг 1/2: Введите название платежа:',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отменить', 'payment_link:cancel')]])
    }
  )
})

// Обработка текста
adminPaymentLinkScene.on('text', async (ctx) => {
  const step = ctx.session.paymentLinkStep

  if (step === 1) {
    // Сохранить название
    ctx.session.paymentLinkData.title = ctx.message.text
    ctx.session.paymentLinkStep = 2

    await ctx.reply(
      '💳 *Создание ссылки на оплату*\n\nШаг 2/2: Введите сумму (в шекелях):',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отменить', 'payment_link:cancel')]])
      }
    )
  } else if (step === 2) {
    // Проверить сумму
    const amount = parseFloat(ctx.message.text)
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('❌ Некорректная сумма. Введите число больше 0:')
    }

    ctx.session.paymentLinkData.amount = amount

    // Создать ссылку
    try {
      await ctx.reply('⏳ Создаю ссылку на оплату...')

      const orderId = 'ADM_' + Date.now()
      const paymentUrl = await createPaymentLink({
        orderId,
        amount,
        description: ctx.session.paymentLinkData.title
      })

      ctx.session.paymentLinkData.url = paymentUrl
      ctx.session.paymentLinkData.orderId = orderId

      // Показать ссылку
      await ctx.reply(
        `✅ *Ссылка создана!*\n\n` +
        `📝 Название: ${ctx.session.paymentLinkData.title}\n` +
        `💰 Сумма: ₪${amount}\n\n` +
        `🔗 Ссылка:\n${paymentUrl}`,
        {
          parse_mode: 'Markdown',
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
  // TODO: Переход к выбору тарифов (чекбоксы)
  await ctx.reply('📤 Функция рассылки в разработке...')
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
