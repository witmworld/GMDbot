import { Markup } from 'telegraf'

export async function showMainMenu(ctx) {
  await ctx.reply(
    `Выберите действие 👇`,
    Markup.inlineKeyboard([
      [{ text: '🎓 Вступить в Клуб', callback_data: 'menu:tariff' }],
      [{ text: '💳 Оплатить доступ', callback_data: 'menu:access' }],
      [{ text: '📄 Загрузить документы', callback_data: 'menu:documents' }],
      [{ text: '✅ Верифицировать данные', callback_data: 'menu:subscribe' }],
    ])
  )
}
