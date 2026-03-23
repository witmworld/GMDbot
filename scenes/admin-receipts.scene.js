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

  if (!file.file_name?.match(/\.(xlsx|xls)$/i)) {
    return ctx.reply('❌ Загрузите Excel файл', backButton)
  }

  // Защита от повторной обработки
  if (ctx.session.processingReceipts) {
    return ctx.reply('⏳ Файл уже обрабатывается')
  }

  ctx.session.processingReceipts = true

  // СРАЗУ отвечаем пользователю
  await ctx.reply('✅ Файл получен! Начинаю обработку...')

  // Обработка в фоне (не блокирует webhook)
  setImmediate(async () => {
    try {
      let rows
      try {
        const fileLink = await ctx.telegram.getFileLink(file.file_id)
        const res = await fetch(fileLink.href)
        const buffer = Buffer.from(await res.arrayBuffer())

        console.log('[Admin Receipts] File size:', buffer.length)
        console.log('[Admin Receipts] Reading Excel...')
        const workbook = XLSX.read(buffer)
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        rows = XLSX.utils.sheet_to_json(sheet)
        console.log('[Admin Receipts] Total rows:', rows.length)
      } catch (err) {
        console.error('❌ Ошибка чтения Excel:', err)
        await ctx.reply(`❌ Не удалось прочитать файл: ${err.message}`, backButton)
        ctx.session.processingReceipts = false
        return
      }

      const successful = rows.filter(r => String(r.status).toLowerCase() === 'successful')

      if (successful.length === 0) {
        await ctx.reply(`В файле ${rows.length} строк, но ни одна со статусом "successful".`, backButton)
        ctx.session.processingReceipts = false
        return
      }

      await ctx.reply(`Найдено ${successful.length} успешных платежей из ${rows.length}. Создаю квитанции...`)

      let created = 0
      const errors = []

      for (const row of successful) {
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

          if (created % 5 === 0 || created === successful.length) {
            await ctx.reply(`Создаю квитанции... ${created}/${successful.length}`)
          }
        } catch (err) {
          console.error(`❌ Ошибка квитанции для ${row.client_name}:`, err)
          errors.push(`${row.client_name || row.client_email || '?'}: ${err.message}`)
        }
      }

      let summary = `✅ Готово! Создано ${created} квитанций из ${successful.length}.`

      if (errors.length > 0) {
        summary += `\n\n❌ Ошибки (${errors.length}):\n` + errors.slice(0, 10).join('\n')
        if (errors.length > 10) {
          summary += `\n...и ещё ${errors.length - 10}`
        }
      }

      await ctx.reply(summary, backButton)
      ctx.session.processingReceipts = false

    } catch (error) {
      console.error('[Admin Receipts] Error:', error)
      await ctx.reply('❌ Ошибка обработки')
      ctx.session.processingReceipts = false
    }
  })
})
