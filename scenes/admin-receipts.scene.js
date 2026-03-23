import { Scenes, Markup } from 'telegraf'
import { createReceipt } from '../integrations/greeninvoice.js'
import XLSX from 'xlsx'
import fetch from 'node-fetch'

const backButton = Markup.inlineKeyboard([
  [{ text: '⬅️ Назад', callback_data: 'back:MENU' }]
])

export const adminReceiptsScene = new Scenes.BaseScene('ADMIN_RECEIPTS')

adminReceiptsScene.enter(async (ctx) => {
  await ctx.reply('Загрузите Excel файл со списком платежей', backButton)
})

adminReceiptsScene.on('callback_query', async (ctx) => {
  if (ctx.callbackQuery.data === 'back:MENU') {
    await ctx.answerCbQuery()
    return ctx.scene.enter('MENU')
  }
})

adminReceiptsScene.on('document', async (ctx) => {
  const file = ctx.message.document

  console.log('[Admin Receipts] ===== FILE RECEIVED =====')
  console.log('[Admin Receipts] User:', ctx.from.id, ctx.from.username)
  console.log('[Admin Receipts] File name:', file.file_name)
  console.log('[Admin Receipts] File size:', file.file_size)
  console.log('[Admin Receipts] File ID:', file.file_id)

  if (!file.file_name?.match(/\.(xlsx|xls)$/i)) {
    return ctx.reply('❌ Загрузите Excel файл')
  }

  await ctx.reply('⏳ Анализирую файл (без создания квитанций)...')

  try {
    const fileLink = await ctx.telegram.getFileLink(file.file_id)
    console.log('[Admin Receipts] File link:', fileLink.href)

    const res = await fetch(fileLink.href)
    const buffer = Buffer.from(await res.arrayBuffer())
    console.log('[Admin Receipts] Downloaded buffer size:', buffer.length)

    const workbook = XLSX.read(buffer)
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet)
    console.log('[Admin Receipts] Total rows read:', rows.length)

    const successful = rows.filter(r => String(r.status).toLowerCase() === 'successful')
    console.log('[Admin Receipts] Successful rows:', successful.length)

    // Показать первые 3 строки для проверки
    console.log('[Admin Receipts] First 3 rows:')
    successful.slice(0, 3).forEach((row, i) => {
      console.log(`  ${i + 1}. ${row.client_name} - ${row.client_email} - ${row.amount}`)
    })

    // ЗАКОММЕНТИРОВАНО: создание квитанций
    /*
    let created = 0
    for (const row of successful) {
      await createReceipt({
        clientName: row.client_name || '',
        clientEmail: row.client_email || '',
        clientPhone: row.client_phone || '',
        amount: Number(row.amount) || 0,
        description: 'תרומה',
        orderId: row.order_id || ''
      })
      created++
    }
    */

    await ctx.reply(
      `📊 Анализ файла:\n\n` +
      `Всего строк: ${rows.length}\n` +
      `Successful: ${successful.length}\n\n` +
      `⚠️ Создание квитанций отключено (тестовый режим)`
    )
  } catch (err) {
    console.error('[Admin Receipts] Error:', err)
    await ctx.reply(`❌ Ошибка: ${err.message}`, backButton)
  }
})
