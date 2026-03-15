export async function handleBack(ctx) {
  const data = ctx.callbackQuery.data

  if (!data.startsWith('back:')) return false

  const targetScene = data.split(':')[1]

  await ctx.answerCbQuery()
  await ctx.scene.enter(targetScene)
  return true
}
