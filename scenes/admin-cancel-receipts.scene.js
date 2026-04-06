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

  // Прочитать Excel с явным указанием кодировки для иврита
  const workbook = xlsx.read(buffer, { type: 'buffer', codepage: 1255 })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const data = xlsx.utils.sheet_to_json(sheet)

  // Лог реальных колонок после декодирования
  const COLUMN = 'מזהה מסמך'
  const FALLBACK_INDEX = 13 // 14-я колонка (индекс 13)

  if (data.length > 0) {
    const cols = Object.keys(data[0])
    console.log('[Cancel Receipts] Columns after decode:', cols)
    console.log('[Cancel Receipts] Looking for:', COLUMN)
    console.log('[Cancel Receipts] Column found by name:', COLUMN in data[0])
  }

  // Читать по имени колонки, fallback — по индексу 13
  const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1 })
  const useByName = data.length > 0 && (COLUMN in data[0])

  const documentIds = []

  if (useByName) {
    console.log('[Cancel Receipts] Reading by column name')
    for (const row of data) {
      const id = row[COLUMN]
      if (typeof id === 'string' && id.trim()) documentIds.push(id.trim())
    }
  } else {
    console.log(`[Cancel Receipts] Fallback: reading by index ${FALLBACK_INDEX}`)
    for (const row of rawRows.slice(1)) { // пропустить заголовок
      const id = row[FALLBACK_INDEX]
      if (typeof id === 'string' && id.trim()) documentIds.push(id.trim())
    }
    // Сообщить какие реальные колонки нашли
    if (data.length > 0) {
      const cols = Object.keys(data[0])
      const col14 = rawRows[0]?.[FALLBACK_INDEX] ?? '—'
      await ctx.reply(
        `⚠️ Колонка "${COLUMN}" не найдена по имени — читаю по индексу 13.\n` +
        `14-я колонка в файле: "${col14}"\n\n` +
        `Все колонки:\n${cols.join('\n')}`
      )
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
