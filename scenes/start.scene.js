import { Scenes } from 'telegraf'

export const startScene = new Scenes.BaseScene('START')

startScene.enter(async (ctx) => {
  await ctx.reply(
    `Привет, ${ctx.from.first_name}! 👋\n\n` +
    `Добро пожаловать в закрытый клуб «Где мои деньги».`
  )

  return ctx.scene.enter('MENU')
})
