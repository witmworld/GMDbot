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
import { adminCalendarScene } from './scenes/admin-calendar.scene.js'
import { adminMenuScene } from './scenes/admin-menu.scene.js'
import { adminPaymentLinkScene } from './scenes/admin-payment-link.scene.js'
import { broadcastSelectScene } from './scenes/broadcast-select.scene.js'
import { adminCancelReceiptsScene } from './scenes/admin-cancel-receipts.scene.js'
import { adminWebinarScene } from './scenes/admin-webinar.scene.js'
import { menuScene } from './scenes/menu.scene.js'
import { subscribeScene } from './scenes/subscribe.scene.js'
import { scanGroupMembers } from './utils/group-scanner.js'
import { startScheduler, checkScheduledMessages } from './utils/scheduler.js'
import { getTariffs, getClubMembers, getClubMember, createClubMember, getClubMemberRecord, setMemberAdminFlag, updateClubMemberFields, getMessages } from './integrations/fillout.js'
import { findLeadByOrderId, updateLeadPaymentStatus, updateLeadFields } from './integrations/bitrix.js'
import { createReceipt } from './integrations/greeninvoice.js'

process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled Rejection:', err)
})

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err)
})

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
console.log('Loaded scene: ADMIN_CALENDAR')
console.log('Loaded scene: MENU')
console.log('Loaded scene: SUBSCRIBE')

try {
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url} from ${req.ip}`)
    next()
  })

  const bot = new Telegraf(process.env.BOT_TOKEN)
  const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID)

  bot.command('ping', async (ctx) => {
    console.log('[PING] Command received!')
    await ctx.reply('🏓 PONG!')
  })

  bot.command('test_admin', async (ctx) => {
    console.log('[TEST] test_admin received from:', ctx.from.id)
    await ctx.reply('Test admin command works!')
  })

  bot.command('force_reset_webhook', async (ctx) => {
    if (ctx.from.id !== 867023416) return

    try {
      // 1. Полностью удалить webhook
      await ctx.telegram.deleteWebhook({ drop_pending_updates: true })
      await ctx.reply('✅ Webhook deleted')

      // 2. Подождать 3 секунды
      await new Promise(resolve => setTimeout(resolve, 3000))

      // 3. Установить заново с секретным токеном
      const WEBHOOK_URL = process.env.WEBHOOK_DOMAIN + '/webhook'
      const secret = Math.random().toString(36).substring(7)
      await ctx.telegram.setWebhook(WEBHOOK_URL, { secret_token: secret })

      await ctx.reply('✅ Webhook set with secret: ' + secret)

      // 4. Проверить
      const info = await ctx.telegram.getWebhookInfo()
      await ctx.reply(JSON.stringify(info, null, 2))
    } catch (err) {
      await ctx.reply('❌ Error: ' + err.message)
    }
  })

  bot.command('reset_webhook', async (ctx) => {
    if (ctx.from.id !== 867023416) return

    try {
      await ctx.reply('⏳ Сбрасываю webhook...')

      await ctx.telegram.deleteWebhook({ drop_pending_updates: true })
      await ctx.reply('✅ Старый webhook удалён, pending updates очищены')

      const WEBHOOK_URL = process.env.WEBHOOK_DOMAIN + '/webhook'
      await ctx.telegram.setWebhook(WEBHOOK_URL)
      await ctx.reply('✅ Новый webhook установлен: ' + WEBHOOK_URL)

      const info = await ctx.telegram.getWebhookInfo()
      await ctx.reply('📊 Webhook Info:\nURL: ' + info.url + '\nPending: ' + info.pending_update_count)
    } catch (err) {
      await ctx.reply('❌ Ошибка: ' + err.message)
    }
  })

  bot.command('test_calendar', async (ctx) => {
    console.log('[TEST] ===== CALENDAR TEST STARTED =====')
    console.log('[TEST] From user:', ctx.from.id)

    if (ctx.from.id !== 867023416) {
      return await ctx.reply('❌ Нет доступа')
    }

    await ctx.reply('⏳ Проверяю Calendar API...')

    try {
      const gcal = await import('./integrations/googleCalendar.js')
      const testEvent = await gcal.createTestEvent()

      await ctx.reply(`✅ Календарь работает!\n\nEvent ID: ${testEvent.id}\nLink: ${testEvent.htmlLink}`)
    } catch (err) {
      console.error('[TEST] Calendar error:', err)
      await ctx.reply('❌ Ошибка Calendar API: ' + err.message)
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
    adminCalendarScene,
    adminMenuScene,
    adminPaymentLinkScene,
    broadcastSelectScene,
    adminCancelReceiptsScene,
    adminWebinarScene,
    menuScene,
    subscribeScene
  ])
  console.log('Scenes registered:', stage.scenes.size)

  bot.use(session({ getSessionKey: (ctx) => String(ctx.from?.id) }))

  bot.use(stage.middleware())

  bot.use((ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') return
    return next()
  })

  bot.command('scan_group', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      return ctx.reply('❌ Эта команда работает только в приватном чате с ботом')
    }
    if (ctx.from.id !== 867023416) {
      return ctx.reply('❌ Недостаточно прав')
    }

    const GROUP_ID = -1003528829419

    try {
      await ctx.reply('🔍 Сканирую админов группы...')

      const admins = await ctx.telegram.getChatAdministrators(GROUP_ID)
      console.log('[Scan Group] Found admins:', admins.length)

      let processed = 0
      let created = 0
      let updated = 0
      let errors = 0

      for (const admin of admins) {
        const user = admin.user
        if (user.is_bot) {
          console.log('[Scan Group] Skipping bot:', user.username)
          continue
        }

        try {
          const existing = await getClubMemberRecord(user.id)

          if (existing) {
            await setMemberAdminFlag(existing.id)
            console.log('[Scan Group] Updated admin flag:', user.id, user.username)
            updated++
          } else {
            const newRecord = await createClubMember({
              first_name: user.first_name,
              last_name: user.last_name,
              username: user.username,
              user_id: user.id
            })
            if (newRecord?.record?.id) {
              await setMemberAdminFlag(newRecord.record.id)
            }
            console.log('[Scan Group] Created new member:', user.id, user.username)
            created++
          }

          processed++
        } catch (err) {
          console.error('[Scan Group] Error processing admin:', user.id, err.message)
          errors++
        }
      }

      await ctx.reply(
        `✅ Сканирование завершено!\n\n` +
        `Найдено админов: ${admins.length}\n` +
        `Обработано: ${processed}\n` +
        `Создано новых: ${created}\n` +
        `Обновлено флаг Админ: ${updated}\n` +
        `Ошибок: ${errors}`
      )
    } catch (error) {
      console.error('[Scan Group] Error:', error)
      await ctx.reply('❌ Ошибка при сканировании группы: ' + error.message)
    }
  })

  bot.command('debug_admin', async (ctx) => {
    console.log('[DEBUG] ===== COMMAND RECEIVED =====')
    console.log('[DEBUG] User ID:', ctx.from.id, 'type:', typeof ctx.from.id)

    try {
      const member = await getClubMember(ctx.from.id)
      console.log('[DEBUG] Member found:', !!member)
      if (member) {
        console.log('[DEBUG] Member data:', JSON.stringify(member, null, 2))
      }
      await ctx.reply('✅ Check logs')
    } catch (err) {
      console.error('[DEBUG] Error:', err)
      await ctx.reply('❌ Error: ' + err.message)
    }
  })

  bot.start(async (ctx) => {
    ctx.session = {}
    return ctx.scene.enter('START')
  })
  bot.command('menu', (ctx) => ctx.scene.enter('MENU'))
  bot.command('admin_menu', async (ctx) => {
    console.log('[ADMIN_MENU] Command received from:', ctx.from.id)
    return ctx.scene.enter('ADMIN_MENU')
  })
  bot.command('admin_calendar', (ctx) => {
    console.log('[ADMIN_CAL] ===== COMMAND RECEIVED =====')
    console.log('[ADMIN_CAL] From user:', ctx.from.id)
    console.log('[ADMIN_CAL] Has scene?', !!ctx.scene)

    if (ctx.from.id !== 867023416) {
      console.log('[ADMIN_CAL] Access denied')
      return
    }

    console.log('[ADMIN_CAL] Entering scene...')
    return ctx.scene.enter('ADMIN_CALENDAR')
  })
  bot.hears('Админ Календарь', (ctx) => {
    if (ctx.from.id !== 867023416) return
    return ctx.scene.enter('ADMIN_CALENDAR')
  })

  bot.use(async (ctx, next) => {
    console.log('[Webhook] ===== INCOMING =====')
    console.log('[Webhook] Type:', ctx.updateType)
    console.log('[Webhook] From:', ctx.from?.id, ctx.from?.username)
    console.log('[Webhook] Text:', ctx.message?.text || ctx.callbackQuery?.data)
    await next()
  })

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

  bot.catch((err, ctx) => {
    console.error('[BOT ERROR]', err)
    console.error('[BOT ERROR] Update:', JSON.stringify(ctx.update))
  })

  app.get('/health', (req, res) => {
    console.log('[Health] Check received')
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      webhook: process.env.WEBHOOK_DOMAIN
    })
  })

  // Webhook path — регистрируем СИНХРОННО до app.listen()
  const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN || 'https://gmd-bot-production-9d5b.up.railway.app'
  const webhookPath = '/webhook'

  app.post('/webhook', (req, res, next) => {
    console.log('[Webhook] ===== RAW POST REQUEST =====')
    console.log('[Webhook] Headers:', JSON.stringify(req.headers))
    console.log('[Webhook] Body:', JSON.stringify(req.body))
    console.log('[Webhook] URL:', req.url)
    next()
  })

  app.use(bot.webhookCallback(webhookPath))
  console.log('[Webhook] Callback registered for path:', webhookPath)

  // Async init: scheduler + setWebhook
  ;(async () => {
    try {
      console.log('=== BEFORE BOT LAUNCH ===')

      console.log('[Init] Starting scheduler and initial check...')
      await checkScheduledMessages(bot)
      console.log('[Init] Initial check completed')
      startScheduler(bot)
      console.log('[Init] Daily scheduler started')

      console.log('[Webhook] Setting webhook to:', WEBHOOK_DOMAIN + webhookPath)
      await bot.telegram.setWebhook(WEBHOOK_DOMAIN + webhookPath)
      console.log('🤖 Где мои деньги · Клуб — бот запущен (webhook mode)')

      try {
        const webhookInfo = await bot.telegram.getWebhookInfo()
        console.log('[Webhook] ===== INFO =====')
        console.log('[Webhook] URL:', webhookInfo.url)
        console.log('[Webhook] Has custom certificate:', webhookInfo.has_custom_certificate)
        console.log('[Webhook] Pending updates:', webhookInfo.pending_update_count)
        console.log('[Webhook] Last error:', webhookInfo.last_error_message || 'none')
        console.log('[Webhook] Last error date:', webhookInfo.last_error_date || 'none')
      } catch (err) {
        console.error('[Webhook] Error getting info:', err.message)
      }
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
      const telegramId = body.order_id.split('_')[0]
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

          if (receiptUrl && telegramId) {
            await bot.telegram.sendMessage(
              telegramId,
              `תודה! 🙏\nקבלה נשלחה לאימייל שלך.\nלצפייה בקבלה: ${receiptUrl}`
            )
          }
        } catch (err) {
          console.error('❌ Ошибка создания квитанции GreenInvoice:', err)
        }

        if (/доступ|вебинар/i.test(body.name || '') && telegramId) {
          console.log(`[Webhook] Access payment for telegramId: ${telegramId}`)
          try {
            const memberRecord = await getClubMemberRecord(telegramId)
            if (memberRecord) {
              const today = new Date()
              const dd = String(today.getDate()).padStart(2, '0')
              const mm = String(today.getMonth() + 1).padStart(2, '0')
              const yyyy = today.getFullYear()
              const dateStr = `${dd}/${mm}/${yyyy}`
              await updateClubMemberFields(memberRecord.id, { 'Вебинар': dateStr })
              console.log(`[Webhook] Updated Вебинар field for telegramId: ${telegramId} → ${dateStr}`)
            }
            const messages = await getMessages()
            const now = Date.now()
            const recent = messages
              .filter(m => m.fields['ZOOM_URL'] && m.fields['Время рассылки'])
              .filter(m => {
                const t = new Date(m.fields['Время рассылки']).getTime()
                return t > now - 3 * 60 * 60 * 1000
              })
              .sort((a, b) => new Date(a.fields['Время рассылки']) - new Date(b.fields['Время рассылки']))
            const zoomUrl = recent[0]?.fields['ZOOM_URL'] || null
            const webinarMsg = zoomUrl
              ? `✅ Оплата получена!\nСсылка на вебинар: ${zoomUrl}`
              : '✅ Оплата получена!\nСсылка на Zoom придёт вам в боте незадолго до начала вебинара.'
            await bot.telegram.sendMessage(telegramId, webinarMsg)
          } catch (err) {
            console.error(`[Webhook] Webinar update failed for telegramId ${telegramId}:`, err.message)
          }
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
