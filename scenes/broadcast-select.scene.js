import { Scenes, Markup } from 'telegraf'
import { getMembersByTariffs } from '../integrations/fillout.js'

export const broadcastSelectScene = new Scenes.BaseScene('BROADCAST_SELECT')

const TARIFFS = ['КЛУБ', 'ПРЕМИУМ', 'БАЗА', 'ПРАКТИКА', 'ПРАКТИКА+', 'СОПРОВОЖДЕНИЕ', 'ТЕСТ']

function buildKeyboard(selected) {
  const rows = TARIFFS.map(tariff => {
    const isSelected = selected.includes(tariff)
    const emoji = isSelected ? '☑️' : '☐'
    return [Markup.button.callback(`${emoji} ${tariff}`, `tariff:${tariff}`)]
  })
  rows.push([
    Markup.button.callback('✅ Разослать', 'broadcast:send'),
    Markup.button.callback('❌ Отменить', 'broadcast:cancel'),
  ])
  return Markup.inlineKeyboard(rows)
}

broadcastSelectScene.enter(async (ctx) => {
  ctx.session.selectedTariffs = []
  await ctx.reply('👥 *Выберите тарифы для рассылки:*', {
    parse_mode: 'Markdown',
    ...buildKeyboard([]),
  })
})

broadcastSelectScene.action(/^tariff:(.+)$/, async (ctx) => {
  const tariff   = ctx.match[1]
  const selected = ctx.session.selectedTariffs || []

  if (selected.includes(tariff)) {
    ctx.session.selectedTariffs = selected.filter(t => t !== tariff)
  } else {
    ctx.session.selectedTariffs = [...selected, tariff]
  }

  await ctx.answerCbQuery()
  await ctx.editMessageReplyMarkup(buildKeyboard(ctx.session.selectedTariffs).reply_markup)
})

broadcastSelectScene.action('broadcast:send', async (ctx) => {
  const selected = ctx.session.selectedTariffs || []
  if (selected.length === 0) {
    await ctx.answerCbQuery('⚠️ Выберите хотя бы один тариф')
    return
  }
  await ctx.answerCbQuery()
  await ctx.reply(`⏳ Рассылаю для: ${selected.join(', ')}...`)

  let members
  try {
    members = await getMembersByTariffs(selected)
  } catch (e) {
    await ctx.reply('❌ Ошибка получения участников: ' + e.message)
    return ctx.scene.enter('ADMIN_MENU')
  }

  const broadcastData = ctx.session.broadcastData
  if (!broadcastData?.messages?.length) {
    await ctx.reply('❌ Нет данных для рассылки')
    return ctx.scene.enter('ADMIN_MENU')
  }

  let sentCount = 0
  for (const msg of broadcastData.messages) {
    for (const member of members) {
      try {
        await ctx.telegram.sendMessage(
          String(member.fields['telegram_id']),
          msg.text,
          msg.extra || {}
        )
        sentCount++
      } catch (e) {
        console.error('[Broadcast] sendMessage failed for', member.fields['telegram_id'], e.message)
      }
    }
  }

  await ctx.reply(`✅ Готово! Отправлено: ${sentCount} (${members.length} участников × ${broadcastData.messages.length} сообщ.)`)
  return ctx.scene.enter('ADMIN_MENU')
})

broadcastSelectScene.action('broadcast:cancel', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('❌ Отменено')
  return ctx.scene.enter('ADMIN_MENU')
})
