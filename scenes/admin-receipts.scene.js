import { Scenes, Markup } from 'telegraf'
import { createReceipt } from '../integrations/greeninvoice.js'
import XLSX from 'xlsx'
import fetch from 'node-fetch'

export const adminReceiptsScene = new Scenes.BaseScene('ADMIN_RECEIPTS')

adminReceiptsScene.enter(async (ctx) => {
  ctx.session.processingReceipts = false
  ctx.session.receiptsToCreate = []
  await ctx.reply(
    '📂 Загрузите Excel файл со списком платежей',
    Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Назад', 'back:ADMIN_MENU')]
    ])
  )
})

adminReceiptsScene.action('back:ADMIN_MENU', async (ctx) => {
  await ctx.answerCbQuery()
  return ctx.scene.enter('ADMIN_MENU')
})

adminReceiptsScene.on('callback_query', async (ctx) => {
  await ctx.answerCbQuery()
})

adminReceiptsScene.on('document', async (ctx) => {
  const file = ctx.message.document

  // Защита от повторной обработки
  if (ctx.session.processingReceipts) {
    return ctx.reply('⏳ Файл уже обрабатывается, подождите...')
  }

  console.log('[Admin Receipts] ===== FILE RECEIVED =====')
  console.log('[Admin Receipts] User:', ctx.from.id, ctx.from.username)
  console.log('[Admin Receipts] File name:', file.file_name)
  console.log('[Admin Receipts] File size:', file.file_size)

  if (!file.file_name?.match(/\.(xlsx|xls)$/i)) {
    return ctx.reply('❌ Загрузите Excel файл (.xlsx или .xls)')
  }

  // Сразу отвечаем (не блокируем webhook)
  await ctx.reply('✅ Файл получен! Анализирую...')

  ctx.session.processingReceipts = true

  try {
    const fileLink = await ctx.telegram.getFileLink(file.file_id)
    const res = await fetch(fileLink.href)
    const buffer = Buffer.from(await res.arrayBuffer())

    console.log('[Admin Receipts] Downloaded buffer size:', buffer.length)

    const workbook = XLSX.read(buffer)
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet)

    console.log('[Admin Receipts] Total rows read:', rows.length)

    const successful = rows.filter(r => String(r.status).toLowerCase() === 'successful')
    const withReceipt = rows.filter(r => r.receipt && r.receipt !== 'not issued')
    const withoutReceipt = successful.filter(r => !r.receipt || r.receipt === 'not issued')

    console.log('[Admin Receipts] Successful:', successful.length)
    console.log('[Admin Receipts] With receipt:', withReceipt.length)
    console.log('[Admin Receipts] Without receipt:', withoutReceipt.length)

    // Сохранить данные в session для подтверждения
    ctx.session.receiptsToCreate = withoutReceipt
    ctx.session.processingReceipts = false

    // Показать preview
    await ctx.reply(
      `📊 *Анализ файла:*\n\n` +
      `Всего транзакций: ${rows.length}\n` +
      `Успешных: ${successful.length}\n` +
      `С квитанциями: ${withReceipt.length}\n` +
      `БЕЗ квитанций: ${withoutReceipt.length}\n\n` +
      `⚠️ Создам *${withoutReceipt.length}* новых квитанций\n\n` +
      `Продолжить?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Создать квитанции', 'receipts:confirm')],
          [Markup.button.callback('❌ Отменить', 'receipts:cancel')]
        ])
      }
    )
  } catch (error) {
    console.error('[Admin Receipts] Error:', error)
    ctx.session.processingReceipts = false
    await ctx.reply('❌ Ошибка при чтении файла')
  }
})

// Обработка подтверждения
adminReceiptsScene.action('receipts:confirm', async (ctx) => {
  await ctx.answerCbQuery()

  const receiptsToCreate = ctx.session.receiptsToCreate || []

  if (receiptsToCreate.length === 0) {
    return ctx.reply('❌ Нет квитанций для создания')
  }

  await ctx.reply(`⏳ Создаю ${receiptsToCreate.length} квитанций...`)

  let created = 0
  const errors = []

  for (const row of receiptsToCreate) {
    try {
      await createReceipt({
        clientName: row.client_name || '',
        clientEmail: row.client_email || '',
        clientPhone: row.client_phone || '',
        amount: Number(row.amount) || 0,
        description: 'תרומה',
        orderId: row.order_id || ''
      })
      created++

      // Прогресс каждые 5 квитанций
      if (created % 5 === 0 || created === receiptsToCreate.length) {
        await ctx.reply(`⏳ Создаю квитанции... ${created}/${receiptsToCreate.length}`)
      }
    } catch (err) {
      console.error('[Admin Receipts] createReceipt error:', err)
      errors.push(`${row.client_email}: ${err.message}`)
    }
  }

  delete ctx.session.receiptsToCreate

  await ctx.reply(
    `✅ Готово!\n\n` +
    `Создано: ${created}\n` +
    `Ошибок: ${errors.length}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Назад', 'back:ADMIN_MENU')]
    ])
  )
})

// Обработка отмены
adminReceiptsScene.action('receipts:cancel', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('❌ Отменено')
  delete ctx.session.receiptsToCreate
  return ctx.scene.enter('ADMIN_MENU')
})
