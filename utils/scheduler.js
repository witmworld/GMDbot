import { getMessages, getClubMembers, clearSendFlag } from '../integrations/fillout.js'

export function startScheduler(bot) {
  console.log('[Scheduler] Started — checking every 5 min')

  setInterval(async () => {
    let messages
    try {
      messages = await getMessages()
    } catch (e) {
      console.error('[Scheduler] getMessages failed:', e.message)
      return
    }

    const pending = messages.filter(m => m.fields['send'] === true)
    if (!pending.length) return

    for (const msg of pending) {
      const id     = msg.id
      const text   = msg.fields['Текст сообщения']
      const tariff = msg.fields['Тариф'] || null

      if (!text) continue

      console.log(`[Scheduler] Processing manual send for message ID: ${id} | tariff: "${tariff ?? 'all'}"`)

      try {
        await clearSendFlag(id)
      } catch (e) {
        console.error('[Scheduler] clearSendFlag failed:', e.message)
        continue
      }

      let allMembers
      try {
        allMembers = await getClubMembers()
      } catch (e) {
        console.error('[Scheduler] getClubMembers failed:', e.message)
        continue
      }

      const targets = allMembers.filter(m => {
        const tgId       = m.fields['telegram_id']
        const userTariff = m.fields['Тариф']
        if (!tgId) return false
        if (tariff) return userTariff === tariff
        return true
      })

      let sent = 0
      for (const member of targets) {
        try {
          await bot.telegram.sendMessage(String(member.fields['telegram_id']), text)
          sent++
        } catch (e) {
          console.error(`[Scheduler] sendMessage failed for ${member.fields['telegram_id']}:`, e.message)
        }
      }

      console.log(`[Scheduler] Broadcast sent: ${sent} recipients for tariff "${tariff ?? 'all'}"`)
    }
  }, 5 * 60_000)
}
