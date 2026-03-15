import { Scenes } from 'telegraf'
import { showMainMenu } from '../utils/menu.js'

export const menuScene = new Scenes.BaseScene('MENU')

menuScene.enter(async (ctx) => {
  console.log('Entering scene: MENU')
  await showMainMenu(ctx)
})

menuScene.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data
  await ctx.answerCbQuery()

  if (data === 'menu:tariff') return ctx.scene.enter('TARIFF')
  if (data === 'menu:access') return ctx.scene.enter('ACCESS')
  if (data === 'menu:documents') return ctx.scene.enter('DOCUMENTS')
  if (data === 'menu:subscribe') return ctx.scene.enter('SUBSCRIBE')
})

menuScene.on('text', async (ctx) => {
  if (ctx.message.text === 'Админ Кабала') {
    return ctx.scene.enter('ADMIN_RECEIPTS')
  }
})
