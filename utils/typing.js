const activeTyping = new Map()

function getChatId(ctx) {
  return ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id
}

export function startTyping(ctx, interval = 4000) {
  const chatId = getChatId(ctx)
  if (!chatId) return () => {}

  stopTyping(ctx)

  ctx.sendChatAction('typing')

  const timer = setInterval(() => {
    ctx.sendChatAction('typing')
  }, interval)

  activeTyping.set(chatId, timer)

  return () => stopTyping(ctx)
}

export function stopTyping(ctx) {
  const chatId = getChatId(ctx)
  if (!chatId) return

  const timer = activeTyping.get(chatId)
  if (timer) {
    clearInterval(timer)
    activeTyping.delete(chatId)
  }
}
