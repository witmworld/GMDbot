import { Scenes } from 'telegraf'
import { askAI } from '../ai/openai.js'
import { getTariffs } from '../integrations/fillout.js'
import { startTyping } from '../utils/typing.js'
import { Keyboards } from '../ui/keyboards.js'
import { handleGlobalCallbacks } from '../ui/handlers.js'

export const aiScene = new Scenes.BaseScene('AI_HELP')

async function runAI(ctx, question = '') {
  const stop = startTyping(ctx)

  let tariffs = []
  try {
    tariffs = await getTariffs()
  } catch (e) {
    console.error('[AI] Не удалось загрузить тарифы из Fillout:', e.message)
  }

  let answer
  try {
    answer = await askAI({ question, tariffs })
  } finally {
    stop()
  }

  await ctx.reply(answer)

  const lower = answer.toLowerCase()
  if (lower.includes('готовы оформить') || lower.includes('перейти к оплате')) {
    await ctx.reply('Что дальше?', {
      reply_markup: Keyboards.aiAfterAnswer()
    })
  }
}

aiScene.enter(async (ctx) => {
  const question =
    ctx.scene.state?.question || 'Расскажи, чем отличаются тарифы и кому что подойдёт'
  await runAI(ctx, question)
})

aiScene.on('text', async (ctx) => {
  await runAI(ctx, ctx.message.text)
})

aiScene.on('callback_query', async (ctx) => {
  if (await handleGlobalCallbacks(ctx)) return
  await ctx.answerCbQuery()
})