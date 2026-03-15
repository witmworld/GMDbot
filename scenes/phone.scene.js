import { Scenes } from 'telegraf'

export const phoneScene = new Scenes.BaseScene('PHONE')

phoneScene.enter(async (ctx) => {
  await ctx.reply('📱 Введи номер телефона в формате +9725 или 05')
})

phoneScene.on('text', async (ctx) => {
  const phone = ctx.message.text.trim()

  if ((!phone.startsWith('05') && !phone.startsWith('+')) || phone.length < 10) {
    return ctx.reply('❌ Некорректный формат. Пример: +972.. или 0501234567')
  }

  ctx.session.phone = phone

  await ctx.reply('Отлично 👍 Теперь укажи email :')

  return ctx.scene.enter('EMAIL')
})
