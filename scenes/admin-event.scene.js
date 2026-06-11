import { Scenes, Markup } from 'telegraf'
import moment from 'moment-timezone'
import { isAdmin } from '../utils/adminCheck.js'
import { createMessage, updateMessage, getMessages, getClubMembers, clearSendFlag } from '../integrations/fillout.js'
import { hasActiveWebinarAccess } from '../utils/scheduler.js'

const MONTHS = {
  'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
  'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
}

const escapeHtml = (text) => text?.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || ''

function parseWebinarDate(text) {
  const match = text.trim().match(/^(\d{1,2})\s+(\S+)\s+(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const [, day, monthStr, hours, minutes] = match
  const month = MONTHS[monthStr.toLowerCase()]
  if (!month) return null
  const year = moment.tz('Asia/Jerusalem').year()
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(parseInt(day)).padStart(2, '0')} ${hours}:${minutes}`
  const m = moment.tz(dateStr, 'YYYY-MM-DD HH:mm', 'Asia/Jerusalem')
  return m.isValid() ? m : null
}

// Все участники с telegram_id (КЛУБ = все тарифы включая ТЕСТ)
function filterTargets(members) {
  return members.filter(m => !!m.fields['telegram_id'])
}

export const adminEventScene = new Scenes.BaseScene('ADMIN_EVENT')

const cancelKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('❌ Отменить', 'event:cancel')]
])

adminEventScene.enter(async (ctx) => {
  const admin = await isAdmin(ctx.from.id)
  if (!admin) {
    await ctx.reply('❌ У вас нет доступа к этому разделу')
    return ctx.scene.leave()
  }

  ctx.session.eventStep = 1
  ctx.session.eventData = {}

  await ctx.reply(
    '📅 <b>Создание мероприятия</b>\n\nШаг 1/5: Введите дату и время:\n<i>Например: 4 мая 19:00</i>',
    { parse_mode: 'HTML', ...cancelKeyboard }
  )
})

adminEventScene.on('text', async (ctx) => {
  const step = ctx.session.eventStep
  const data = ctx.session.eventData

  if (step === 1) {
    const m = parseWebinarDate(ctx.message.text)
    if (!m) {
      return ctx.reply('❌ Не могу распознать дату. Введите в формате <i>"4 мая 19:00"</i>:', { parse_mode: 'HTML' })
    }
    data.dateText = ctx.message.text.trim()
    data.dateIso  = m.toISOString()
    ctx.session.eventStep = 2
    return ctx.reply(
      '📝 <b>Создание мероприятия</b>\n\nШаг 2/5: Введите заголовок мероприятия:',
      { parse_mode: 'HTML', ...cancelKeyboard }
    )
  }

  if (step === 2) {
    data.title = ctx.message.text.trim()
    ctx.session.eventStep = 3
    return ctx.reply(
      '🎤 <b>Создание мероприятия</b>\n\nШаг 3/5: Введите имя ведущего:',
      { parse_mode: 'HTML', ...cancelKeyboard }
    )
  }

  if (step === 3) {
    data.speaker = ctx.message.text.trim()
    ctx.session.eventStep = 4
    return ctx.reply(
      '📋 <b>Создание мероприятия</b>\n\nШаг 4/5: Введите описание (что узнают участники):',
      { parse_mode: 'HTML', ...cancelKeyboard }
    )
  }

  if (step === 4) {
    data.description = ctx.message.text.trim()
    ctx.session.eventStep = 5
    return ctx.reply(
      '🔗 <b>Создание мероприятия</b>\n\nШаг 5/5: Введите ссылку на Zoom:\n<i>Отправьте `-` если ссылки пока нет</i>',
      { parse_mode: 'HTML', ...cancelKeyboard }
    )
  }

  if (step === 5) {
    const input = ctx.message.text.trim()
    data.zoomUrl = input === '-' ? null : input
    return showPreview(ctx)
  }
})

async function showPreview(ctx) {
  const d = ctx.session.eventData
  await ctx.reply(
    `📋 <b>Проверьте данные мероприятия:</b>\n\n` +
    `📅 Дата: ${escapeHtml(d.dateText)}\n` +
    `📝 Заголовок: ${escapeHtml(d.title)}\n` +
    `🎤 Ведущий: ${escapeHtml(d.speaker)}\n` +
    `📋 Описание: ${escapeHtml(d.description)}\n` +
    `🔗 Zoom: ${escapeHtml(d.zoomUrl) || 'не указан'}\n\n` +
    `📣 Получат все участники (КЛУБ)`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Создать', 'event:confirm')],
        [Markup.button.callback('❌ Отмена',  'event:cancel')],
      ])
    }
  )
}

adminEventScene.action('event:confirm', async (ctx) => {
  await ctx.answerCbQuery()
  const d        = ctx.session.eventData
  const telegram = ctx.telegram

  await ctx.reply('⏳ Создаю мероприятие...')

  try {
    const dateMatch = d.dateText.match(/^(.+)\s+(\d{1,2}:\d{2})$/)
    const datePart  = dateMatch ? dateMatch[1] : d.dateText
    const timePart  = dateMatch ? dateMatch[2] : ''

    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const zoom          = d.zoomUrl
    const zoomLine = zoom ? `<a href="${zoom}">Ссылка на Zoom</a>\n\n` : ''

    const t24h = moment.tz(d.dateIso, 'Asia/Jerusalem').subtract(24, 'hours')
    const t1h  = moment.tz(d.dateIso, 'Asia/Jerusalem').subtract(1, 'hour')
    const t15m = moment.tz(d.dateIso, 'Asia/Jerusalem').subtract(15, 'minutes')

    const text24h =
      `Привет! 👋 Завтра, ${datePart} в ${timePart} — ${esc(d.title)} с ${esc(d.speaker)}.\n\n` +
      `${esc(d.description)}\n\n` +
      `${zoomLine}` +
      `Есть вопросы? Пишите @where_is_themoney`

    const text1h =
      `Привет! Через час — ${esc(d.title)} с ${esc(d.speaker)}.\n\n` +
      `${zoomLine}` +
      `Есть вопросы? Пишите @where_is_themoney`

    const text15m =
      `Через 15 минут начинаем! 🎙 ${esc(d.title)} с ${esc(d.speaker)}.\n\n` +
      `${zoomLine}` +
      `Есть вопросы? Пишите @where_is_themoney`

    const records = [
      { text: text24h, tariff: 'КЛУБ', sendTime: t24h.format(), zoomUrl: zoom },
      { text: text1h,  tariff: 'КЛУБ', sendTime: t1h.format(),  zoomUrl: zoom },
      { text: text15m, tariff: 'КЛУБ', sendTime: t15m.format(), zoomUrl: zoom },
    ]

    for (const rec of records) {
      const created  = await createMessage({
        text:     rec.text,
        tariff:   rec.tariff,
        sendTime: rec.sendTime,
        zoomUrl:  rec.zoomUrl || null,
        send:     true,
      })
      console.log('[Event] createMessage response:', JSON.stringify(created))
      const recordId = created?.record?.id
      const label    = moment.tz(rec.sendTime, 'Asia/Jerusalem').format('DD.MM HH:mm')
      console.log(`[Event] Created: КЛУБ @ ${label} | id: ${recordId}`)

      const delay = new Date(rec.sendTime).getTime() - Date.now()
      if (delay > 0 && recordId) {
        setTimeout(async () => {
          try {
            await clearSendFlag(recordId)
            const allMembers = await getClubMembers()
            const targets    = filterTargets(allMembers)
            for (const member of targets) {
              try {
                await telegram.sendMessage(String(member.fields['telegram_id']), rec.text, {
                  parse_mode: 'HTML',
                  link_preview_options: { is_disabled: true }
                })
              } catch (e) {
                console.error(`[Event] Send failed for ${member.fields['telegram_id']}:`, e.message)
              }
            }
            console.log(`[Event] Sent КЛУБ @ ${label} → ${targets.length} members`)

            if (rec.text.startsWith('Через 15 минут')) {
              try {
                const thisSend = new Date(rec.sendTime).getTime()
                const allMsgs  = await getMessages()
                const toDeactivate = allMsgs.filter(m => {
                  const t = m.fields['Время рассылки']
                  if (!t) return false
                  return Math.abs(new Date(t).getTime() - thisSend) <= 25 * 60 * 60 * 1000
                })
                for (const r of toDeactivate) {
                  await updateMessage(r.id, { Active: false })
                }
                console.log(`[Event] Set Active=false on ${toDeactivate.length} event records`)
              } catch (e) {
                console.error(`[Event] Failed to deactivate event records:`, e.message)
              }
            }
          } catch (e) {
            console.error(`[Event] Scheduled send error (КЛУБ @ ${label}):`, e.message)
          }
        }, delay)
        console.log(`[Event] Scheduled КЛУБ message for ${label}`)
      }
    }

    await ctx.reply(
      `✅ <b>Мероприятие создано!</b>\n\n` +
      `📋 Записей: 3 (все тарифы)\n\n` +
      `⏰ Расписание:\n` +
      `• ${t24h.tz('Asia/Jerusalem').format('DD.MM в HH:mm')} — за 24ч\n` +
      `• ${t1h.tz('Asia/Jerusalem').format('DD.MM в HH:mm')} — за 1ч\n` +
      `• ${t15m.tz('Asia/Jerusalem').format('DD.MM в HH:mm')} — за 15мин`,
      { parse_mode: 'HTML' }
    )
  } catch (err) {
    console.error('[Event] Create error:', err)
    await ctx.reply('❌ Ошибка при создании мероприятия: ' + err.message)
  }

  return ctx.scene.enter('ADMIN_MENU')
})

adminEventScene.action('event:cancel', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('❌ Отменено')
  return ctx.scene.enter('ADMIN_MENU')
})
