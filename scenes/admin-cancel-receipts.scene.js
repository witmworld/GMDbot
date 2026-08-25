import { Scenes, Markup } from 'telegraf'
import fetch from 'node-fetch'
import * as xlsx from 'xlsx'
import iconv from 'iconv-lite'
import { cancelGreenInvoiceDocument, getDocument } from '../integrations/greeninvoice.js'

export const adminCancelReceiptsScene = new Scenes.BaseScene('ADMIN_CANCEL_RECEIPTS')

// Грубая классификация имени по алфавиту — для сводки перед реальной отменой:
// подтверждаем, что иврит/кириллица/латиница из GreenInvoice приходят читаемыми.
function classifyName(name) {
  if (!name || !String(name).trim()) return 'empty'
  if (/[֐-׿]/.test(name)) return 'hebrew'
  if (/[Ѐ-ӿ]/.test(name)) return 'cyrillic'
  return 'latin'
}

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

  // Имя и e-mail клиента из Excel не берём: колонка לקוח в значительной части
  // строк физически пуста, а ивритские значения — мохибейк win1255 (кириллица
  // в выгрузке Morning невосстановима в принципе — win1255 её не кодирует).
  // Из Excel нужны только id документа и сумма; имя запрашивается из
  // исходного документа в cancelGreenInvoiceDocument.
  const COL_NUMBER = 'מספר המסמך'
  const COL_AMOUNT = 'סכום'
  const numberIndex = decodedHeaders.indexOf(COL_NUMBER)
  const amountIndex = decodedHeaders.indexOf(COL_AMOUNT)
  console.log(`[Cancel Receipts] Number column "${COL_NUMBER}" → index ${numberIndex}`)
  console.log(`[Cancel Receipts] Amount column "${COL_AMOUNT}" → index ${amountIndex}`)

  // Читать данные по найденным индексам
  const receipts = []
  for (const row of rawRows.slice(1)) {
    const id = row[useIndex]
    if (typeof id === 'string' && id.trim()) {
      receipts.push({
        id:     id.trim(),
        number: numberIndex !== -1 ? row[numberIndex] : null, // для отчёта об ошибках, в API не передаётся
        amount: amountIndex !== -1 ? Number(row[amountIndex]) || 0 : 0,
      })
    }
  }

  if (receipts.length === 0) {
    ctx.session.receiptIds = []
    return ctx.reply('❌ В файле не найдено ни одной строки с id документа')
  }

  await ctx.reply(`📋 Найдено квитанций: ${receipts.length}\n\n⏳ Запрашиваю имена клиентов из GreenInvoice...`)

  // Preflight: подтягиваем реального client.name по каждому id ДО отмены —
  // чтобы админ увидел, что иврит/кириллица/латиница приходят читаемыми,
  // прежде чем нажать "Отменить все". На самой отмене cancelGreenInvoiceDocument
  // запросит документ заново — это чтение не экономит вызов, а лишь даёт превью.
  const counts = { hebrew: 0, cyrillic: 0, latin: 0, empty: 0, error: 0 }
  let checked = 0
  for (const receipt of receipts) {
    try {
      const original = await getDocument(receipt.id)
      receipt.previewName = original.client?.name || ''
      counts[classifyName(receipt.previewName)]++
    } catch (err) {
      receipt.previewError = err.message
      counts.error++
    }
    checked++
    if (checked % 50 === 0) {
      await ctx.reply(`⏳ Проверено: ${checked}/${receipts.length}`)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  ctx.session.receiptIds = receipts

  const MAX_LISTED = 30
  const sampleLines = receipts.slice(0, MAX_LISTED).map(r =>
    r.previewError
      ? `• № ${r.number ?? '—'}: ⚠️ ${r.previewError.slice(0, 80)}`
      : `• № ${r.number ?? '—'}: ${r.previewName || '(пусто)'}`
  )

  let preview =
    `📋 Имена из GreenInvoice (${receipts.length} документов):\n\n` +
    `Иврит: ${counts.hebrew}\n` +
    `Кириллица: ${counts.cyrillic}\n` +
    `Латиница: ${counts.latin}\n` +
    `Пусто: ${counts.empty}\n` +
    `Ошибок запроса: ${counts.error}\n\n` +
    `${sampleLines.join('\n')}`

  if (receipts.length > MAX_LISTED) {
    preview += `\n… и ещё ${receipts.length - MAX_LISTED}`
  }

  preview += `\n\n⚠️ Отмена необратима! Строки с ошибкой запроса или без имени будут пропущены при реальной отмене.`

  await ctx.reply(
    preview,
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
  const failed = [] // { number, id, reason }

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
      failed.push({ number: receipt.number ?? '—', id: receipt.id, reason: err.message })
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  let report =
    `✅ Готово!\n\n` +
    `Всего: ${receipts.length}\n` +
    `Отменено: ${success}\n` +
    `Ошибок: ${failed.length}`

  if (failed.length > 0) {
    const MAX_LISTED = 20
    const lines = failed
      .slice(0, MAX_LISTED)
      .map(f => `• № ${f.number} (${f.id}): ${f.reason.slice(0, 120)}`)
    report += `\n\nНе удалось отменить:\n${lines.join('\n')}`
    if (failed.length > MAX_LISTED) {
      report += `\n… и ещё ${failed.length - MAX_LISTED}`
    }
  }

  await ctx.reply(report)

  return ctx.scene.enter('ADMIN_MENU')
})

adminCancelReceiptsScene.action('cancel:abort', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('❌ Отменено')
  return ctx.scene.enter('ADMIN_MENU')
})
