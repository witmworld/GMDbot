import { Scenes, Markup } from 'telegraf'
import { isAdmin } from '../utils/adminCheck.js'

export const adminMenuScene = new Scenes.BaseScene('ADMIN_MENU')

adminMenuScene.enter(async (ctx) => {
  // Проверка админа
  const admin = await isAdmin(ctx.from.id)
  if (!admin) {
    await ctx.reply('❌ У вас нет доступа к админ-меню')
    return ctx.scene.leave()
  }

  await ctx.reply(
    '👑 *Админ-меню*\n\nВыберите действие:',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📅 Админ Календарь', 'admin:calendar')],
        [Markup.button.callback('🧾 Админ Кабала', 'admin:receipts')],
        [Markup.button.callback('💳 Создать ссылку на оплату', 'admin:payment_link')],
        [Markup.button.callback('🗑 Отменить квитанции', 'admin:cancel_receipts')],
        [Markup.button.callback('📹 Создать вебинар', 'admin:webinar')],
        [Markup.button.callback('⬅️ Главное меню', 'admin:exit')]
      ])
    }
  )
})

// Обработчики кнопок
adminMenuScene.action('admin:calendar', async (ctx) => {
  await ctx.answerCbQuery()
  return ctx.scene.enter('ADMIN_CALENDAR')
})

adminMenuScene.action('admin:receipts', async (ctx) => {
  await ctx.answerCbQuery()
  return ctx.scene.enter('ADMIN_RECEIPTS')
})

adminMenuScene.action('admin:payment_link', async (ctx) => {
  await ctx.answerCbQuery()
  return ctx.scene.enter('ADMIN_PAYMENT_LINK')
})

adminMenuScene.action('admin:cancel_receipts', async (ctx) => {
  await ctx.answerCbQuery()
  return ctx.scene.enter('ADMIN_CANCEL_RECEIPTS')
})

adminMenuScene.action('admin:webinar', async (ctx) => {
  await ctx.answerCbQuery()
  return ctx.scene.enter('ADMIN_WEBINAR')
})

adminMenuScene.action('admin:exit', async (ctx) => {
  await ctx.answerCbQuery()
  return ctx.scene.enter('MENU')
})
