import fetch from 'node-fetch'
import { Scenes } from 'telegraf'
import { handleGlobalCallbacks } from '../ui/handlers.js'
import { getDocuments } from '../integrations/fillout.js'
import { createOrUpdateBitrixLead, uploadDocumentToLead } from '../integrations/bitrix.js'

export const documentsScene = new Scenes.BaseScene('DOCUMENTS')

function ensureDocsSession(ctx) {
  if (!Array.isArray(ctx.session.uploadedDocuments)) {
    ctx.session.uploadedDocuments = []
  }
}

function formatUploadedDocs(ctx) {
  ensureDocsSession(ctx)

  if (ctx.session.uploadedDocuments.length === 0) {
    return 'Пока нет загруженных документов.'
  }

  return ctx.session.uploadedDocuments
    .map((d, i) => `${i + 1}. ${d.name} — ${d.file_name}`)
    .join('\n')
}

async function downloadAndUpload(ctx, fileId, fileName) {
  const fileInfo = await ctx.telegram.getFile(fileId)
  const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`

  const res = await fetch(fileUrl)
  const arrayBuffer = await res.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')

  await createOrUpdateBitrixLead(ctx)
  const leadId = ctx.session.bitrixLeadId

  await uploadDocumentToLead(leadId, fileName, base64)
}

const afterUploadKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📎 Загрузить ещё', callback_data: 'go:documents' }],
      [{ text: '⬅️ В меню', callback_data: 'go:menu' }]
    ]
  }
}

documentsScene.enter(async (ctx) => {
  ensureDocsSession(ctx)

  let docs
  try {
    docs = await getDocuments()
  } catch (e) {
    await ctx.reply('Ошибка загрузки списка документов. Попробуй позже.')
    return
  }

  await ctx.reply(
    '📎 Какие документы ты хочешь загрузить?',
    {
      reply_markup: {
        inline_keyboard: [
          ...docs.map(d => [{ text: d.name, callback_data: `doc:${d.name}` }]),
          [{ text: '📋 Посмотреть загруженные', callback_data: 'docs:list' }],
          [{ text: '⬅️ Назад', callback_data: 'go:menu' }]
        ]
      }
    }
  )
})

documentsScene.on('callback_query', async (ctx) => {
  if (await handleGlobalCallbacks(ctx)) return

  const data = ctx.callbackQuery.data
  await ctx.answerCbQuery()

  ensureDocsSession(ctx)

  if (data === 'docs:list') {
    await ctx.reply(`📎 Загруженные документы:\n\n${formatUploadedDocs(ctx)}`)
    return
  }

  if (data === 'docs:cancel') {
    ctx.session.documentType = null
    await ctx.reply('Загрузка отменена ❌')
    await ctx.scene.reenter()
    return
  }

  if (data.startsWith('doc:')) {
    const name = data.substring('doc:'.length)
    ctx.session.documentType = name

    await ctx.reply(
      `📎 Документ: ${name}\n\nОтправь файл (PDF, документ или фото) одним сообщением 👇`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Отменить', callback_data: 'docs:cancel' }]
          ]
        }
      }
    )
  }
})

documentsScene.on('document', async (ctx) => {
  ensureDocsSession(ctx)

  const name = ctx.session.documentType
  if (!name) {
    await ctx.reply('Сначала выбери тип документа.')
    return
  }

  const file = ctx.message.document
  ctx.session.documentType = null

  ctx.session.uploadedDocuments.push({
    name,
    file_name: file.file_name,
    telegram_file_id: file.file_id,
    kind: 'document'
  })

  try {
    await downloadAndUpload(ctx, file.file_id, file.file_name)
    console.log(`Document uploaded for user ${ctx.from.id}: ${name}`)
    await ctx.reply(`✅ Документ «${name}» загружен!`, afterUploadKeyboard)
  } catch (e) {
    console.error('[Documents] Ошибка загрузки в Bitrix:', e.message)
    await ctx.reply(`⚠️ Файл получен, но не удалось загрузить в CRM. Попробуй ещё раз.`, afterUploadKeyboard)
  }
})

documentsScene.on('photo', async (ctx) => {
  ensureDocsSession(ctx)

  const name = ctx.session.documentType
  if (!name) {
    await ctx.reply('Сначала выбери тип документа.')
    return
  }

  const photo = ctx.message.photo.at(-1)
  const fileName = `${name.replace(/\s+/g, '_')}_${Date.now()}.jpg`
  ctx.session.documentType = null

  ctx.session.uploadedDocuments.push({
    name,
    file_name: fileName,
    telegram_file_id: photo.file_id,
    kind: 'photo'
  })

  try {
    await downloadAndUpload(ctx, photo.file_id, fileName)
    console.log(`Document uploaded for user ${ctx.from.id}: ${name}`)
    await ctx.reply(`✅ Документ «${name}» загружен!`, afterUploadKeyboard)
  } catch (e) {
    console.error('[Documents] Ошибка загрузки фото в Bitrix:', e.message)
    await ctx.reply(`⚠️ Фото получено, но не удалось загрузить в CRM. Попробуй ещё раз.`, afterUploadKeyboard)
  }
})
