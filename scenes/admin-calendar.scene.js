import { Scenes, Markup } from 'telegraf'
import OpenAI from 'openai'
import { getClubMembers } from '../integrations/fillout.js'
import { createCalendarEvent } from '../integrations/googleCalendar.js'

const ADMIN_ID = 867023416

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export const adminCalendarScene = new Scenes.BaseScene('ADMIN_CALENDAR')

// ─── Enter ────────────────────────────────────────────────────────────────────

adminCalendarScene.enter(async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    await ctx.reply('❌ Нет доступа')
    return ctx.scene.leave()
  }

  ctx.session.adminCalStep   = 1
  ctx.session.adminCalEvents = null

  await ctx.reply(
    '📅 *Парсер расписания*\n\nОтправьте текст расписания для парсинга:',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отменить', 'cal:cancel')]]),
    }
  )
})

// ─── Callbacks ────────────────────────────────────────────────────────────────

adminCalendarScene.on('callback_query', async (ctx) => {
  await ctx.answerCbQuery()
  const data = ctx.callbackQuery.data

  if (data === 'cal:cancel') {
    await ctx.reply('Отменено.')
    return ctx.scene.leave()
  }

  if (data === 'cal:confirm') {
    const events = ctx.session.adminCalEvents
    if (!events?.length) {
      await ctx.reply('❌ Нет событий для создания.')
      return ctx.scene.leave()
    }

    await ctx.reply('⏳ Создаю события в Google Calendar и отправляю рассылку...')

    let members
    try {
      members = await getClubMembers()
    } catch (e) {
      await ctx.reply('❌ Не удалось получить участников: ' + e.message)
      return ctx.scene.leave()
    }

    let createdCount = 0
    let sentCount    = 0

    for (const event of events) {
      // Create in Google Calendar
      let htmlLink = null
      try {
        const created = await createCalendarEvent(event)
        htmlLink = created.htmlLink
        createdCount++
        console.log('[AdminCal] Created event:', event.title, htmlLink)
      } catch (e) {
        console.error('[AdminCal] createCalendarEvent failed:', e.message)
      }

      // Filter members by tariff
      const eventTariffs = event.tariffs?.filter(t => t && t !== 'ВСЕ')
      const targets = members.filter(m => {
        const tgId = m.fields['telegram_id']
        if (!tgId) return false
        if (!eventTariffs?.length) return true
        return eventTariffs.includes(m.fields['Тариф'])
      })

      // Build message
      const addToCalLink = buildAddToCalLink(event)
      let msg = `📅 *${escMd(event.title)}*\n`
      if (event.date || event.time) {
        msg += `🕐 ${event.date || ''} ${event.time || ''}`.trim()
        if (event.duration) msg += ` _(${event.duration})_`
        msg += '\n'
      }
      if (event.description) msg += `\n${escMd(event.description)}\n`
      if (event.link)        msg += `\n🔗 [Ссылка на встречу](${event.link})\n`
      msg += `\n[📆 Добавить в Google Calendar](${addToCalLink})`

      for (const member of targets) {
        try {
          await ctx.telegram.sendMessage(
            String(member.fields['telegram_id']),
            msg,
            { parse_mode: 'Markdown', disable_web_page_preview: false }
          )
          sentCount++
        } catch (e) {
          console.error('[AdminCal] sendMessage failed for', member.fields['telegram_id'], e.message)
        }
      }
    }

    await ctx.reply(
      `✅ Готово!\n\n📅 Создано событий: ${createdCount}/${events.length}\n👥 Сообщений отправлено: ${sentCount}`
    )
    return ctx.scene.leave()
  }
})

// ─── Text (step 1: receive schedule) ─────────────────────────────────────────

adminCalendarScene.on('text', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.scene.leave()
  if (ctx.session.adminCalStep !== 1) return

  const text = ctx.message.text.trim()
  await ctx.reply('⏳ Парсю расписание через GPT-4...')

  let events
  try {
    events = await parseScheduleWithGPT(text)
  } catch (e) {
    console.error('[AdminCal] GPT parse error:', e.message)
    return ctx.reply('❌ Ошибка парсинга: ' + e.message)
  }

  if (!events?.length) {
    return ctx.reply('❌ Не удалось извлечь события из текста. Попробуйте другой формат.')
  }

  ctx.session.adminCalEvents = events
  ctx.session.adminCalStep   = 2

  // Build preview
  let preview = `📋 *Найдено событий: ${events.length}*\n\n`
  events.forEach((e, i) => {
    preview += `*${i + 1}. ${escMd(e.title)}*\n`
    if (e.date || e.time) preview += `🕐 ${e.date || ''} ${e.time || ''}`.trim() + '\n'
    if (e.duration)       preview += `⏱ ${e.duration}\n`
    if (e.description)    preview += `${escMd(e.description)}\n`
    if (e.tariffs?.length) preview += `👥 Тарифы: ${e.tariffs.join(', ')}\n`
    preview += '\n'
  })

  await ctx.reply(preview, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Создать и разослать', 'cal:confirm'),
        Markup.button.callback('❌ Отменить', 'cal:cancel'),
      ],
    ]),
  })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function parseScheduleWithGPT(text) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Ты парсер расписания. Извлеки все события из текста и верни ТОЛЬКО валидный JSON массив.
Формат каждого события:
{
  "date": "YYYY-MM-DD или DD.MM.YYYY (если есть)",
  "time": "HH:MM (если есть)",
  "duration": "например 1.5 часа или 90 минут (если указано)",
  "title": "название события",
  "description": "описание (если есть, иначе пустая строка)",
  "link": "ссылка на встречу (если есть, иначе пустая строка)",
  "tariffs": ["ВСЕ"]
}
Верни ТОЛЬКО JSON массив, без markdown, без пояснений.`,
      },
      { role: 'user', content: text },
    ],
    temperature: 0.1,
  })

  const raw     = response.choices[0].message.content.trim()
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  return JSON.parse(cleaned)
}

function buildAddToCalLink(event) {
  let startStr = ''
  let endStr   = ''

  try {
    const dateRaw = (event.date || '').trim()
    const timeRaw = (event.time || '00:00').trim()

    let iso = dateRaw
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateRaw)) {
      const [d, m, y] = dateRaw.split('.')
      iso = `${y}-${m}-${d}`
    }

    const start = new Date(`${iso}T${timeRaw}:00`)
    if (isNaN(start.getTime())) throw new Error('invalid date')

    let durationMs = 60 * 60 * 1000
    if (event.duration) {
      const h = event.duration.match(/(\d+(?:\.\d+)?)\s*(?:час|hour|ч)/i)
      const m = event.duration.match(/(\d+)\s*(?:мин|min)/i)
      if (h) durationMs = parseFloat(h[1]) * 60 * 60 * 1000
      else if (m) durationMs = parseInt(m[1]) * 60 * 1000
    }

    const end = new Date(start.getTime() + durationMs)
    const fmt = (d) => d.toISOString().replace(/[-:.]/g, '').slice(0, 15)
    startStr = fmt(start)
    endStr   = fmt(end)
  } catch {
    // no dates — link still works without them
  }

  const params = new URLSearchParams({ action: 'TEMPLATE', text: event.title || '' })
  if (startStr && endStr) params.set('dates', `${startStr}/${endStr}`)
  if (event.description)  params.set('details', event.description)
  if (event.link)         params.set('location', event.link)

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function escMd(str) {
  return (str || '').replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1')
}
