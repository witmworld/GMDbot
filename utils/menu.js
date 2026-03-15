import { Markup } from 'telegraf'

export async function showMainMenu(ctx) {
  await ctx.reply(
    `Выберите действие 👇`,
    Markup.inlineKeyboard([
      [{ text: '✅ Верифицировать данные', callback_data: 'menu:subscribe' }]
    ])
  )
}
