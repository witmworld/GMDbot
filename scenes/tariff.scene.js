import { Scenes } from 'telegraf'
import { handleBack } from './nav.js'
import { Buttons } from '../ui/buttons.js'
import { handleGlobalCallbacks } from '../ui/handlers.js'
import { getTariffs } from '../integrations/fillout.js'

export const tariffScene = new Scenes.BaseScene('TARIFF')

tariffScene.enter(async (ctx) => {
  console.log('Entering scene: TARIFF')
  const compact = !!ctx.session.compact
  ctx.session.compact = false

  let tariffs
  try {
    tariffs = await getTariffs()
  } catch (e) {
    await ctx.reply('Ошибка загрузки тарифов. Попробуй позже.')
    return
  }

  const uniqueNames = [...new Set(tariffs.map(t => t.name).filter(Boolean))]
  const rows = uniqueNames.map(name => [{ text: name, callback_data: `tariff:${name}` }])
  if (!compact) rows.push([Buttons.helpChoose()])
  rows.push([Buttons.back('MENU')])

  await ctx.reply('Выбери тариф 👇', { reply_markup: { inline_keyboard: rows } })
  await ctx.reply('Или задай свой вопрос 👇')
})

tariffScene.on('callback_query', async (ctx) => {
  if (await handleGlobalCallbacks(ctx)) return
  if (await handleBack(ctx)) return

  const data = ctx.callbackQuery.data
  await ctx.answerCbQuery()

  if (data === 'tariff:help') {
    await ctx.scene.enter('AI_HELP', {
      question:
        'Помоги выбрать тариф. Задай 2–3 уточняющих вопроса и предложи лучший вариант.'
    })
    return
  }

  if (data.startsWith('tariff:')) {
    ctx.session.tariffName = data.substring('tariff:'.length)
    await ctx.scene.enter('PERIOD')
    return
  }
})

tariffScene.on('text', async (ctx) => {
  const text = ctx.message.text?.trim()
  if (!text) return
  await ctx.scene.enter('AI_HELP', { question: text })
})
