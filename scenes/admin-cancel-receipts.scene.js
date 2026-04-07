import { Scenes, Markup } from 'telegraf'
import fetch from 'node-fetch'
import * as xlsx from 'xlsx'
import iconv from 'iconv-lite'
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

  // Прочитать Excel как raw массив для ручного декодирования заголовков
  const workbook = xlsx.read(buffer, { type: 'buffer' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1 })

  const COLUMN = 'מזהה מסמך'
  const FALLBACK_INDEX = 13 // 14-я колонка (индекс 13)

  // Декодировать заголовок через iconv-lite из Windows-1255
  const decodeHeader = (str) => {
    if (typeof str !== 'string') return str
    try {
      return iconv.decode(Buffer.from(str, 'binary'), 'win1255')
    } catch {
      return str
    }
  }

  const rawHeaders = rawRows[0] ?? []
  const decodedHeaders = rawHeaders.map(decodeHeader)

  console.log('[Cancel Receipts] Raw headers:', rawHeaders)
  console.log('[Cancel Receipts] Decoded (win1255) headers:', decodedHeaders)

  // Найти индекс нужной колонки по декодированному имени
  const colIndex = decodedHeaders.indexOf(COLUMN)
  const useIndex = colIndex !== -1 ? colIndex : FALLBACK_INDEX

  console.log(`[Cancel Receipts] Column "${COLUMN}" → ${colIndex !== -1 ? `index ${colIndex}` : `NOT FOUND, fallback to index ${FALLBACK_INDEX}`}`)
  console.log(`[Cancel Receipts] 14th column decoded: "${decodedHeaders[FALLBACK_INDEX] ?? '—'}"`)

  if (colIndex === -1) {
    await ctx.reply(
      `⚠️ Колонка "${COLUMN}" не найдена — читаю по индексу ${FALLBACK_INDEX}.\n` +
      `14-я колонка: "${decodedHeaders[FALLBACK_INDEX] ?? '—'}"\n\n` +
      `Все заголовки:\n${decodedHeaders.join('\n')}`
    )
  }

  // Найти индексы колонок клиента
  const COL_NAME  = 'לקוח'
  const COL_EMAIL = 'מייל לקוח'
  const nameIndex  = decodedHeaders.indexOf(COL_NAME)
  const emailIndex = decodedHeaders.indexOf(COL_EMAIL)
  console.log(`[Cancel Receipts] Name column "${COL_NAME}" → index ${nameIndex}`)
  console.log(`[Cancel Receipts] Email column "${COL_EMAIL}" → index ${emailIndex}`)

  // Читать данные по найденным индексам
  const receipts = []
  for (const row of rawRows.slice(1)) {
    const id = row[useIndex]
    if (typeof id === 'string' && id.trim()) {
      receipts.push({
        id:    id.trim(),
        name:  nameIndex !== -1 && row[nameIndex] ? String(row[nameIndex]).trim() : '',
        email: emailIndex !== -1 && row[emailIndex] ? String(row[emailIndex]).trim() : 'email@gmail.com',
      })
    }
  }

  ctx.session.receiptIds = receipts

  await ctx.reply(
    `📋 Найдено квитанций: ${receipts.length}\n\n⚠️ Это действие нельзя отменить!`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Отменить все', 'cancel:confirm')],
      [Markup.button.callback('❌ Отмена', 'cancel:abort')]
    ])
  )
})

adminCancelReceiptsScene.action('cancel:confirm', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('⏳ Отменяю квитанции...')

  const receipts = ctx.session.receiptIds
  let success = 0
  let errors = 0

  for (const receipt of receipts) {
    try {
      await cancelGreenInvoiceDocument(receipt)
      success++

      // Показывать прогресс каждые 50 квитанций
      if (success % 50 === 0) {
        await ctx.reply(`⏳ Обработано: ${success}/${receipts.length}`)
      }
    } catch (err) {
      console.error('[Cancel Receipt] Error:', receipt.id, err)
      errors++
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  await ctx.reply(
    `✅ Готово!\n\n` +
    `Всего: ${receipts.length}\n` +
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
