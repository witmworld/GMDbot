import { Scenes, Markup } from 'telegraf'
import OpenAI from 'openai'
import { getClubMembers } from '../integrations/fillout.js'
import { createCalendarEvent } from '../integrations/googleCalendar.js'

const ADMIN_ID = 867023416

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export const adminCalendarScene = new Scenes.BaseScene('ADMIN_CALENDAR')

// ─── Step 1: Enter — ask for schedule text ────────────────────────────────────

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

  // Step 2 → confirm preview: ask audience
  if (data === 'cal:confirm') {
    if (!ctx.session.adminCalEvents?.length) {
      await ctx.reply('❌ Нет событий для создания.')
      return ctx.scene.leave()
    }
    ctx.session.adminCalStep = 3
    await ctx.reply(
      '👥 *Кому разослать события?*',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('📢 КЛУБ (все участники)', 'cal:audience:club'),
            Markup.button.callback('🧪 ТЕСТ', 'cal:audience:test'),
          ],
          [Markup.button.callback('❌ Отменить', 'cal:cancel')],
        ]),
      }
    )
    return
  }

  // Step 3 → audience chosen: create events + broadcast
  if (data === 'cal:audience:club' || data === 'cal:audience:test') {
    const events = ctx.session.adminCalEvents
    if (!events?.length) {
      await ctx.reply('❌ Нет событий.')
      return ctx.scene.leave()
    }

    const audience = data === 'cal:audience:club' ? 'club' : 'test'
    const label    = audience === 'club' ? 'КЛУБ (все)' : 'ТЕСТ'
    await ctx.reply(`⏳ Создаю события и рассылаю для *${label}*...`, { parse_mode: 'Markdown' })

    let members
    try {
      members = await getClubMembers()
    } catch (e) {
      await ctx.reply('❌ Не удалось получить участников: ' + e.message)
      return ctx.scene.leave()
    }

    const targets = members.filter(m => {
      const tgId   = m.fields['telegram_id']
      const tariff = m.fields['Тариф']
      if (!tgId) return false
      if (audience === 'club') return true
      return tariff === 'ТЕСТ'
    })

    console.log(`[AdminCal] Audience: ${label}, targets: ${targets.length}`)

    let createdCount = 0
    let sentCount    = 0

    for (const event of events) {
      // Create in Google Calendar
      try {
        const created = await createCalendarEvent(event)
        console.log('[AdminCal] Created event:', event.title, created.htmlLink)
        createdCount++
      } catch (e) {
        console.error('[AdminCal] createCalendarEvent failed:', e.message)
      }

      // Build calendar links
      const googleLink  = buildGoogleLink(event)
      const outlookLink = buildOutlookLink(event)

      // Build message text
      let msg = ''
      if (event.date || event.time) msg += `📅 ${event.date || ''} ${event.time || ''}`.trim() + '\n'
      msg += `*${event.title}*`
      if (event.description) msg += `\n\n${event.description}`
      if (event.link)        msg += `\n\n🔗 Zoom: ${event.link}`
      msg += '\n\n📆 Добавить в календарь:'

      const calButtons = Markup.inlineKeyboard([
        [
          Markup.button.url('Google', googleLink),
          Markup.button.url('Outlook', outlookLink),
        ],
      ])

      for (const member of targets) {
        try {
          await ctx.telegram.sendMessage(
            String(member.fields['telegram_id']),
            msg,
            { parse_mode: 'Markdown', ...calButtons }
          )
          sentCount++
        } catch (e) {
          console.error('[AdminCal] sendMessage failed for', member.fields['telegram_id'], e.message)
        }
      }
    }

    await ctx.reply(
      `✅ Готово!\n\n📅 Создано событий: ${createdCount}/${events.length}\n👥 Отправлено: ${sentCount} из ${targets.length} участников`
    )
    return ctx.scene.leave()
  }
})

// ─── Step 1: receive schedule text ───────────────────────────────────────────

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
    if (e.date || e.time) preview += `📅 ${e.date || ''} ${e.time || ''}`.trim() + '\n'
    if (e.duration)       preview += `⏱ ${e.duration}\n`
    if (e.description)    preview += `${escMd(e.description)}\n`
    if (e.link)           preview += `🔗 ${escMd(e.link)}\n`
    preview += '\n'
  })

  await ctx.reply(preview, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Создать', 'cal:confirm'),
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
  "date": "DD.MM.YYYY (если есть, иначе пустая строка)",
  "time": "HH:MM (если есть, иначе пустая строка)",
  "duration": "например 1.5 часа или 90 минут (если указано, иначе пустая строка)",
  "title": "название события",
  "description": "описание (если есть, иначе пустая строка)",
  "link": "ссылка на встречу (если есть, иначе пустая строка)"
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

function parseDatetime(event) {
  const dateRaw = (event.date || '').trim()
  const timeRaw = (event.time || '00:00').trim()

  let iso = dateRaw
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateRaw)) {
    const [d, m, y] = dateRaw.split('.')
    iso = `${y}-${m}-${d}`
  }

  const start = new Date(`${iso}T${timeRaw}:00`)
  if (isNaN(start.getTime())) return null

  let durationMs = 60 * 60 * 1000
  if (event.duration) {
    const h = event.duration.match(/(\d+(?:\.\d+)?)\s*(?:час|hour|ч)/i)
    const m = event.duration.match(/(\d+)\s*(?:мин|min)/i)
    if (h) durationMs = parseFloat(h[1]) * 60 * 60 * 1000
    else if (m) durationMs = parseInt(m[1]) * 60 * 1000
  }

  return { start, end: new Date(start.getTime() + durationMs) }
}

function buildGoogleLink(event) {
  const params = new URLSearchParams({ action: 'TEMPLATE', text: event.title || '' })
  const dt = parseDatetime(event)
  if (dt) {
    const fmt = (d) => d.toISOString().replace(/[-:.]/g, '').slice(0, 15)
    params.set('dates', `${fmt(dt.start)}/${fmt(dt.end)}`)
  }
  if (event.description) params.set('details', event.description)
  if (event.link)        params.set('location', event.link)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function buildOutlookLink(event) {
  const params = new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent' })
  if (event.title)       params.set('subject', event.title)
  if (event.description) params.set('body', event.description)
  if (event.link)        params.set('location', event.link)
  const dt = parseDatetime(event)
  if (dt) {
    params.set('startdt', dt.start.toISOString())
    params.set('enddt',   dt.end.toISOString())
  }
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`
}

function escMd(str) {
  return (str || '').replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1')
}
