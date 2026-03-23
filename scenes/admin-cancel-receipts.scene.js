import { Scenes, Markup } from 'telegraf'
import fetch from 'node-fetch'
import * as xlsx from 'xlsx'
import { cancelGreenInvoiceDocument } from '../integrations/greeninvoice.js'

export const adminCancelReceiptsScene = new Scenes.BaseScene('ADMIN_CANCEL_RECEIPTS')

adminCancelReceiptsScene.enter(async (ctx) => {
  ctx.session.receiptIds = []
  await ctx.reply(
    '🧾 *Отмена квитанций*\n\nЗагрузите Excel файл с квитанциями для отмены:',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel:abort')]])
    }
  )
})

adminCancelReceiptsScene.on('document', async (ctx) => {
  const file = ctx.message.document

  if (!file.file_name.endsWith('.xlsx') && !file.file_name.endsWith('.xls')) {
    return ctx.reply('❌ Загрузите Excel файл (.xlsx или .xls)')
  }

  await ctx.reply('⏳ Обрабатываю файл...')

  // Скачать файл
  const fileLink = await ctx.telegram.getFileLink(file.file_id)
  const response = await fetch(fileLink.href)
  const buffer = await response.arrayBuffer()

  // Прочитать Excel
  const workbook = xlsx.read(buffer)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const data = xlsx.utils.sheet_to_json(sheet)

  // Найти колонку с Document ID (UUID формат)
  const documentIds = []
  for (const row of data) {
    for (const value of Object.values(row)) {
      if (typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)) {
        documentIds.push(value)
        break
      }
    }
  }

  ctx.session.receiptIds = documentIds

  await ctx.reply(
    `📋 Найдено квитанций: ${documentIds.length}\n\n⚠️ Это действие нельзя отменить!`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Отменить все', 'cancel:confirm')],
      [Markup.button.callback('❌ Отмена', 'cancel:abort')]
    ])
  )
})

adminCancelReceiptsScene.action('cancel:confirm', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('⏳ Отменяю квитанции...')

  const ids = ctx.session.receiptIds
  let success = 0
  let errors = 0

  for (const id of ids) {
    try {
      await cancelGreenInvoiceDocument(id)
      success++

      // Показывать прогресс каждые 50 квитанций
      if (success % 50 === 0) {
        await ctx.reply(`⏳ Обработано: ${success}/${ids.length}`)
      }
    } catch (err) {
      console.error('[Cancel Receipt] Error:', id, err)
      errors++
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  await ctx.reply(
    `✅ Готово!\n\n` +
    `Всего: ${ids.length}\n` +
    `Отменено: ${success}\n` +
    `Ошибок: ${errors}`
  )

  return ctx.scene.enter('ADMIN_MENU')
})

adminCancelReceiptsScene.action('cancel:abort', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('❌ Отменено')
  return ctx.scene.enter('ADMIN_MENU')
})
