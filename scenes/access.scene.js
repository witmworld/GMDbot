import { Scenes, Markup } from 'telegraf'
import { handleBack } from './nav.js'
import { handleGlobalCallbacks } from '../ui/handlers.js'
import { getAccess } from '../integrations/fillout.js'
import { createPayment } from '../integrations/allpay.js'

export const accessScene = new Scenes.BaseScene('ACCESS')

function generateOrderId(ctx) {
  return `${ctx.from.id}_${Date.now()}`
}

// Шаг 1: список доступов
accessScene.enter(async (ctx) => {
  console.log('Entering scene: ACCESS')
  let items
  try {
    items = await getAccess()
  } catch (e) {
    await ctx.reply('Ошибка загрузки доступов. Попробуй позже.', Markup.inlineKeyboard([
      [{ text: '⬅️ Назад', callback_data: 'back:MENU' }]
    ]))
    return
  }

  if (!items.length) {
    await ctx.reply('Доступы не найдены.', Markup.inlineKeyboard([
      [{ text: '⬅️ Назад', callback_data: 'back:MENU' }]
    ]))
    return
  }

  const rows = items.map(item => [{ text: item.name, callback_data: `access:${item.name}` }])
  rows.push([{ text: '⬅️ Назад', callback_data: 'back:MENU' }])

  await ctx.reply('Выбери доступ 👇', Markup.inlineKeyboard(rows))
})

accessScene.on('callback_query', async (ctx) => {
  if (await handleGlobalCallbacks(ctx)) return
  if (await handleBack(ctx)) return

  const data = ctx.callbackQuery.data
  await ctx.answerCbQuery()

  // Шаг 2: пользователь выбрал доступ — показываем сумму и кнопки
  if (data.startsWith('access:') && data !== 'access:pay') {
    const accessName = data.substring('access:'.length)

    let items
    try {
      items = await getAccess()
    } catch (e) {
      await ctx.reply('Ошибка загрузки данных. Попробуй позже.')
      return
    }

    const item = items.find(i => i.name === accessName)
    if (!item?.amount) {
      await ctx.reply('Не удалось получить сумму. Попробуй позже.')
      return
    }

    ctx.session.accessName = accessName
    ctx.session.accessAmount = item.amount

    await ctx.reply(
      `${accessName}\nСумма: ${item.amount} ₪`,
      Markup.inlineKeyboard([
        [{ text: '💳 Оплатить', callback_data: 'access:pay' }],
        [{ text: '⬅️ Назад', callback_data: 'back:ACCESS' }]
      ])
    )
    return
  }

  // Шаг 3: пользователь нажал "Оплатить" — создаём платёж
  if (data === 'access:pay') {
    const accessName = ctx.session.accessName
    const amount = ctx.session.accessAmount

    if (!accessName || !amount) {
      await ctx.reply('Данные устарели. Выбери доступ заново.')
      await ctx.scene.reenter()
      return
    }

    const orderId = generateOrderId(ctx)
    ctx.session.orderId = orderId

    let result
    try {
      result = await createPayment({
        orderId,
        amount,
        description: accessName,
        customerPhone: ctx.session.phone,
        customerEmail: ctx.session.email
      })
    } catch (e) {
      console.error('❌ Ошибка AllPay (access):', e)
      await ctx.reply('Ошибка при создании платежа. Попробуй позже.')
      return
    }

    const payUrl = result.payment_url
    if (!payUrl) {
      console.error('AllPay (access): нет ссылки на оплату', result)
      await ctx.reply('Не удалось создать платёж. Попробуй позже.')
      return
    }

    console.log(`Payment created: ${orderId}`)

    await ctx.reply(
      `Заказ создан!\n\nДоступ: ${accessName}\nСумма: ${amount} ₪\n\nНажми кнопку ниже для оплаты 👇`,
      Markup.inlineKeyboard([
        [Markup.button.url('💳 Оплатить', payUrl)],
        [{ text: '⬅️ Назад', callback_data: 'back:MENU' }]
      ])
    )
  }
})
