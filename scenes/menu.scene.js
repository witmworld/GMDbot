import { Scenes } from 'telegraf'
import { showMainMenu } from '../utils/menu.js'

export const menuScene = new Scenes.BaseScene('MENU')

menuScene.enter(async (ctx) => {
  console.log('[MENU] Scene entered for user:', ctx.from.id)
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

menuScene.on('text', async (ctx, next) => {
  const text = ctx.message.text

  // Если это команда (начинается с /) — пропустить дальше
  if (text.startsWith('/')) {
    console.log('[MENU] Command detected, passing to handler:', text)
    return next()
  }

  console.log('[MENU] Text received:', text)

  // Обработка триггеров
  if (text === 'Админ Кабала') {
    return ctx.scene.enter('ADMIN_RECEIPTS')
  }

  // Для остального текста — тоже передать дальше
  return next()
})
