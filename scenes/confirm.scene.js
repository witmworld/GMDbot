import { Scenes } from 'telegraf'
import { handleBack } from './nav.js'
import { createOrUpdateBitrixLead } from '../integrations/bitrix.js'
import { Keyboards } from '../ui/keyboards.js'
import { handleGlobalCallbacks } from '../ui/handlers.js'
import { getTariffs } from '../integrations/fillout.js'

export const confirmScene = new Scenes.BaseScene('CONFIRM')

confirmScene.enter(async (ctx) => {
  let amount = ''
  try {
    const tariffs = await getTariffs()
    const match = tariffs.find(
      t => t.name === ctx.session.tariffName && t.term === ctx.session.period
    )
    if (match?.amount != null) amount = `\nСумма: ${match.amount} ₪`
  } catch (e) {
    console.error('[confirm] Ошибка загрузки суммы:', e.message)
  }

  await ctx.reply(
    `Проверь данные:\n\nТариф: ${ctx.session.tariffName}\nПериод: ${ctx.session.period}${amount}\n\nЕсли всё верно — подтвердите и перейдём к оплате.`,
    {
      reply_markup: Keyboards.confirmMenu()
    }
  )
})

confirmScene.on('callback_query', async (ctx) => {
  if (await handleGlobalCallbacks(ctx)) return
  if (await handleBack(ctx)) return

  const data = ctx.callbackQuery.data

  if (data === 'confirm:ok') {
    await ctx.answerCbQuery()

    try {
      await createOrUpdateBitrixLead(ctx)
    } catch (err) {
      console.error('❌ Ошибка Bitrix:', err)
      await ctx.reply('Произошла ошибка при сохранении данных. Попробуйте позже.')
      return
    }

    await ctx.reply('✅ Отлично! Данные сохранены.\n\nПереходим к оплате...')
    await ctx.scene.enter('PAYMENT')
  }
})