import { Scenes } from 'telegraf'
import { handleBack } from './nav.js'
import { Buttons } from '../ui/buttons.js'
import { stopTyping } from '../utils/typing.js'
import { handleGlobalCallbacks } from '../ui/handlers.js'
import { getTariffs } from '../integrations/fillout.js'

export const periodScene = new Scenes.BaseScene('PERIOD')

periodScene.enter(async (ctx) => {
  stopTyping(ctx)

  let tariffs
  try {
    tariffs = await getTariffs()
  } catch (e) {
    await ctx.reply('Ошибка загрузки периодов. Попробуй позже.')
    return
  }

  const tariffName = ctx.session.tariffName
  const matching = tariffs.filter(t => t.name === tariffName)
  const periods = [...new Set(matching.map(t => t.term).filter(Boolean))]

  const rows = periods.map(p => [{ text: p, callback_data: `period:${p}` }])
  rows.push([Buttons.back('TARIFF')])

  await ctx.reply('Выбери период оплаты:', { reply_markup: { inline_keyboard: rows } })
})

periodScene.on('callback_query', async (ctx) => {
  if (await handleGlobalCallbacks(ctx)) return
  if (await handleBack(ctx)) return

  const data = ctx.callbackQuery.data
  await ctx.answerCbQuery()

  if (data.startsWith('period:')) {
    ctx.session.period = data.substring('period:'.length)
    await ctx.scene.enter('CONFIRM')
  }
})
