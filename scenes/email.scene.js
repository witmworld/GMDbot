import { Scenes } from 'telegraf'

export const emailScene = new Scenes.BaseScene('EMAIL')

emailScene.on('text', async (ctx) => {
  const email = ctx.message.text.trim()

  if (!email.includes('@') || !email.includes('.')) {
    return ctx.reply('❌ Похоже email некорректен. Пример: user@mail.com')
  }

  ctx.session.email = email

  const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ')

  await ctx.reply(
    `Супер! 👍 Данные сохранены.\n\n` +
    `Имя: ${name}\n` +
    `Телефон: ${ctx.session.phone}\n` +
    `Email: ${ctx.session.email}`
  )

  return ctx.scene.enter('MENU')
})
