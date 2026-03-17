import 'dotenv/config'
import { Telegraf, Scenes, session } from 'telegraf'
import express from 'express'
import { startScene } from './scenes/start.scene.js'
import { phoneScene } from './scenes/phone.scene.js'
import { emailScene } from './scenes/email.scene.js'
import { tariffScene } from './scenes/tariff.scene.js'
import { periodScene } from './scenes/period.scene.js'
import { confirmScene } from './scenes/confirm.scene.js'
import { paymentScene } from './scenes/payment.scene.js'
import { aiScene } from './scenes/ai.scene.js'
import { documentsScene } from './scenes/documents.scene.js'
import { accessScene } from './scenes/access.scene.js'
import { adminReceiptsScene } from './scenes/admin-receipts.scene.js'
import { menuScene } from './scenes/menu.scene.js'
import { subscribeScene } from './scenes/subscribe.scene.js'
import { scanGroupMembers } from './utils/group-scanner.js'
import { startScheduler, checkScheduledMessages } from './utils/scheduler.js'
import { getTariffs, getClubMembers, createClubMember } from './integrations/fillout.js'
import { findLeadByOrderId, updateLeadPaymentStatus, updateLeadFields } from './integrations/bitrix.js'
import { createReceipt } from './integrations/greeninvoice.js'

console.log('ENV CHECK:', {
  ADMIN_USER_ID: process.env.ADMIN_USER_ID,
  parsed: Number(process.env.ADMIN_USER_ID),
  type: typeof process.env.ADMIN_USER_ID,
})
console.log('=== BOT STARTING ===')
console.log('Loaded scene: START')
console.log('Loaded scene: PHONE')
console.log('Loaded scene: EMAIL')
console.log('Loaded scene: TARIFF')
console.log('Loaded scene: PERIOD')
console.log('Loaded scene: CONFIRM')
console.log('Loaded scene: PAYMENT')
console.log('Loaded scene: AI_HELP')
console.log('Loaded scene: DOCUMENTS')
console.log('Loaded scene: ACCESS')
console.log('Loaded scene: ADMIN_RECEIPTS')
console.log('Loaded scene: MENU')
console.log('Loaded scene: SUBSCRIBE')

try {
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  const bot = new Telegraf(process.env.BOT_TOKEN)
  const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID)

  console.log('Registering scenes...')
  const stage = new Scenes.Stage([
    startScene,
    phoneScene,
    emailScene,
    tariffScene,
    periodScene,
    confirmScene,
    paymentScene,
    aiScene,
    documentsScene,
    accessScene,
    adminReceiptsScene,
    menuScene,
    subscribeScene
  ])
  console.log('Scenes registered:', stage.scenes.size)

  bot.use(session({ getSessionKey: (ctx) => String(ctx.from?.id) }))

  // ─── Admin: pending scan state (intercept before scene) ──────────────────────
  const pendingScan = new Map()

  bot.use(async (ctx, next) => {
    if (
      ctx.message?.text &&
      !ctx.message.text.startsWith('/') &&
      pendingScan.has(ctx.from?.id)
    ) {
      pendingScan.delete(ctx.from.id)
      const groupId = ctx.message.text.trim()
      console.log('=== SCAN GROUP STARTED ===')
      await ctx.reply('Сканирую группу...')
      try {
        const result = await scanGroupMembers(ctx, groupId)
        console.log(`Found ${result.members.length} admins in group`)

        const added = []
        const failed = []
        for (const member of result.members) {
          const name = `${member.first_name || ''} ${member.last_name || ''}`.trim()
          console.log('Processing admin:', {
            name,
            username: member.username || 'NO USERNAME',
            id: member.user_id,
          })
          try {
            await createClubMember(member)
            console.log('✅ Created Fillout record for:', name)
            added.push(member)
          } catch (e) {
            console.error('❌ Failed to create record:', e.message)
            failed.push(member)
          }
        }

        console.log(`=== SCAN COMPLETE: Added ${added.length} records ===`)

        const lines = added.map(m => {
          const name = `${m.first_name || ''} ${m.last_name || ''}`.trim()
          const nick = m.username ? ` (@${m.username})` : ''
          return `• ${name}${nick}`
        })

        let reply = `Сканирование завершено:\n✅ Добавлено: ${added.length} человек\n❌ Ошибок: ${failed.length}`
        if (lines.length) reply += `\n\n${lines.join('\n')}`

        await ctx.reply(reply)
      } catch (err) {
        await ctx.reply(`❌ Ошибка: ${err.message}`)
      }
      return
    }
    return next()
  })

  bot.use(stage.middleware())

  bot.start(async (ctx) => {
    ctx.session = {}
    return ctx.scene.enter('START')
  })
  bot.command('menu', (ctx) => ctx.scene.enter('MENU'))

  // bot.command('scan_group', async (ctx) => {
  //   console.log('SCAN_GROUP COMMAND RECEIVED from user:', ctx.from.id)
  //   console.log('Admin check:', ctx.from.id, 'vs', ADMIN_USER_ID, 'type:', typeof ctx.from.id, typeof ADMIN_USER_ID)
  //   pendingScan.set(ctx.from.id, true)
  //   await ctx.reply('Введи ID группы (например: -1001234567890):', {
  //     reply_markup: { force_reply: true, selective: true },
  //   })
  // })

  // bot.command('test_group', async (ctx) => {
  //   try {
  //     const chat = await ctx.telegram.getChat('-1003528829419')
  //     await ctx.reply('✅ Группа: ' + chat.title)
  //     const admins = await ctx.telegram.getChatAdministrators('-1003528829419')
  //     await ctx.reply('✅ Админов найдено: ' + admins.length)
  //   } catch (err) {
  //     await ctx.reply('❌ Ошибка на этапе админов: ' + err.message)
  //   }
  // })

  bot.command('test_calendar', async (ctx) => {
    console.log('[TEST] test_calendar command received from:', ctx.from.id)

    if (ctx.from.id !== 867023416) {
      return await ctx.reply('❌ Нет доступа')
    }

    try {
      await ctx.reply('⏳ Проверяю Calendar API...')

      const { createTestEvent } = await import('./integrations/googleCalendar.js')
      const result = await createTestEvent()

      await ctx.reply(`✅ Календарь работает!\n\nEvent ID: ${result.eventId}\nLink: ${result.htmlLink}`)
    } catch (err) {
      console.error('[TEST] Calendar error:', err)
      await ctx.reply('❌ Ошибка: ' + err.message)
    }
  })

  bot.command('test_fillout', async (ctx) => {
    if (ctx.from.id !== ADMIN_USER_ID) return

    let msg = '🔍 Проверка подключения к Fillout\n\n'

    try {
      const tariffs = await getTariffs()
      msg += `✅ Тарифы: найдено ${tariffs.length} записей\n`
      tariffs.slice(0, 2).forEach((t, i) => {
        msg += `  ${i + 1}. ${JSON.stringify(t)}\n`
      })
    } catch (e) {
      msg += `❌ Тарифы: ошибка — ${e.message}\n`
    }

    msg += '\n'

    try {
      const members = await getClubMembers()
      msg += `✅ Участники клуба: найдено ${members.length} записей\n`
      members.slice(0, 2).forEach((m, i) => {
        msg += `  ${i + 1}. ${JSON.stringify(m.fields)}\n`
      })
    } catch (e) {
      msg += `❌ Участники клуба: ошибка — ${e.message}\n`
    }

    await ctx.reply(msg)
  })

  ;(async () => {
    try {
      console.log('=== BEFORE BOT LAUNCH ===')

      // Сначала scheduler — до launch, который повисает в webhook режиме
      console.log('[Init] Starting scheduler and initial check...')
      await checkScheduledMessages(bot)
      console.log('[Init] Initial check completed')
      startScheduler(bot)
      console.log('[Init] Daily scheduler started')

      // Потом launch (он повиснет на webhook сервере, это ОК)
      await bot.launch()
      console.log('🤖 Где мои деньги · Клуб — бот запущен')

      const webhookInfo = await bot.telegram.getWebhookInfo()
      console.log('[Webhook] URL:', webhookInfo.url)
      console.log('[Webhook] Pending updates:', webhookInfo.pending_update_count)
    } catch (err) {
      console.error('Bot launch error:', err)
    }
  })()

  app.post('/payment/webhook', async (req, res) => {
    const body = req.body || {}
    console.log(`Payment webhook received: order_id=${body.order_id || 'none'}, status=${body.status || 'none'}`)

    if (body.status === '1' && !body.order_id) {
      try {
        const receipt = await createReceipt({
          clientName: body.client_name || '',
          clientEmail: body.client_email || '',
          clientPhone: body.client_phone || '',
          amount: Number(body.amount) || 0,
          description: 'תרומה'
        })
        const receiptUrl = receipt.receipt_url || receipt.url || receipt.shareUrl || ''
        console.log(`Receipt created for external payment: ${body.client_name}, ${body.amount}₪, receipt: ${receiptUrl}`)
      } catch (err) {
        console.error('❌ Ошибка создания квитанции (external):', err)
      }
    } else if (body.status === '1' && body.order_id) {
      try {
        const lead = await findLeadByOrderId(body.order_id)
        if (lead?.ID) {
          await updateLeadPaymentStatus(lead.ID, body)
        }

        try {
          const receipt = await createReceipt({
            clientName: body.client_name || '',
            clientEmail: body.client_email || '',
            clientPhone: body.client_phone || '',
            amount: Number(body.amount) || 0,
            description: body.name || 'Оплата клуб ГМД',
            orderId: body.order_id
          })

          const receiptUrl = receipt.receipt_url || receipt.url || receipt.shareUrl || ''
          if (receiptUrl && lead?.ID) {
            await updateLeadFields(lead.ID, { UF_CRM_1734183234: receiptUrl })
          }

          if (receiptUrl && body.order_id) {
            const telegramId = body.order_id.split('_')[0]
            if (telegramId) {
              await bot.telegram.sendMessage(
                telegramId,
                `תודה! 🙏\nקבלה נשלחה לאימייל שלך.\nלצפייה בקבלה: ${receiptUrl}`
              )
            }
          }
        } catch (err) {
          console.error('❌ Ошибка создания квитанции GreenInvoice:', err)
        }
      } catch (err) {
        console.error('❌ Ошибка обновления лида после оплаты:', err)
      }
    }

    res.sendStatus(200)
  })

  const PORT = process.env.PORT || 3000
  app.listen(PORT, () => {
    console.log(`Webhook server running on port ${PORT}`)
  })
  console.log('🤖 Где мои деньги · Клуб — бот запущен')

} catch (err) {
  console.error('FATAL ERROR:', err)
  process.exit(1)
}
