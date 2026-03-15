export async function handleGlobalCallbacks(ctx) {
  const data = ctx.callbackQuery?.data
  if (!data) return false

  if (data === 'go:documents') {
    await ctx.answerCbQuery()
    await ctx.scene.enter('DOCUMENTS')
    return true
  }

  if (data === 'go:menu') {
    await ctx.answerCbQuery()
    await ctx.scene.enter('MENU')
    return true
  }

  if (data === 'go:tariffs') {
    await ctx.answerCbQuery()
    ctx.session.compact = true
    await ctx.scene.enter('TARIFF')
    return true
  }

  if (data === 'go:ask') {
    await ctx.answerCbQuery()
    await ctx.reply('Задай свой вопрос 👇')
    return true
  }

  return false
}
