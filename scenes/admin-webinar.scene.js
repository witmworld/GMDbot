import { Scenes, Markup } from 'telegraf'
import moment from 'moment-timezone'
import { isAdmin } from '../utils/adminCheck.js'
import { buildPaymentUrl } from '../integrations/allpay.js'
import { createMessage, updateMessage, getMessages, getClubMembers, clearSendFlag } from '../integrations/fillout.js'
import { hasActiveWebinarAccess } from '../utils/scheduler.js'

const DEFAULT_PRICE_BASE     = 50
const DEFAULT_PRICE_PRACTICE = 30

const escapeHtml = (text) => text?.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || ''

const MONTHS = {
  'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
  'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
}

// Парсит "4 мая 19:00" → moment в Israel timezone
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

// Парсит "4 мая" → { day, month }
function parseDateOnly(text) {
  const match = text.trim().match(/^(\d{1,2})\s+(\S+)$/)
  if (!match) return null
  const [, day, monthStr] = match
  const month = MONTHS[monthStr.toLowerCase()]
  if (!month) return null
  return { day: parseInt(day), month }
}

// Фильтрует участников по тарифу — та же логика что в scheduler
function filterTargets(members, tariff) {
  return members.filter(m => {
    const tg = m.fields['telegram_id']
    if (!tg) return false
    const t = m.fields['Тариф']
    if (!tariff || tariff === 'ВСЕ' || tariff === 'КЛУБ') return true
    if (tariff === 'ПРЕМИУМ') return t !== 'БАЗА'
    if (tariff === 'БАЗА')     return t === 'БАЗА'     && !hasActiveWebinarAccess(m)
    if (tariff === 'ПРАКТИКА') return t === 'ПРАКТИКА' && !hasActiveWebinarAccess(m)
    if (tariff === 'ДОСТУП') {
      if (t === 'ПРАКТИКА+' || t === 'СОПРОВОЖДЕНИЕ') return true
      if ((t === 'БАЗА' || t === 'ПРАКТИКА') && hasActiveWebinarAccess(m)) return true
      return false
    }
    return t === tariff
  })
}

export const adminWebinarScene = new Scenes.BaseScene('ADMIN_WEBINAR')

const cancelKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('❌ Отменить', 'webinar:cancel')]
])

// ── Вход в сцену ──────────────────────────────────────────────────────────────

adminWebinarScene.enter(async (ctx) => {
  const admin = await isAdmin(ctx.from.id)
  if (!admin) {
    await ctx.reply('❌ У вас нет доступа к этому разделу')
    return ctx.scene.leave()
  }

  // ── zoom_only режим ───────────────────────────────────────────────────────
  if (ctx.session.webinarZoomOnly) {
    ctx.session.webinarStep    = 'zoom_only_url'
    ctx.session.webinarZoomData = {}
    return ctx.reply(
      '🔗 <b>Добавить Zoom URL</b>\n\nШаг 1/2: Введите ссылку на Zoom:',
      { parse_mode: 'HTML', ...cancelKeyboard }
    )
  }

  // ── обычный режим ─────────────────────────────────────────────────────────
  ctx.session.webinarStep = 1
  ctx.session.webinarData = {
    priceBase:     DEFAULT_PRICE_BASE,
    pricePractice: DEFAULT_PRICE_PRACTICE,
  }

  await ctx.reply(
    '📅 <b>Создание вебинара</b>\n\nШаг 1/6: Введите дату и время вебинара:\n<i>Например: 4 мая 19:00</i>',
    { parse_mode: 'HTML', ...cancelKeyboard }
  )
})

// ── Текстовые шаги ────────────────────────────────────────────────────────────

adminWebinarScene.on('text', async (ctx) => {
  const step = ctx.session.webinarStep
  const data = ctx.session.webinarData

  // ── zoom_only шаг 1: получить URL ────────────────────────────────────────
  if (step === 'zoom_only_url') {
    ctx.session.webinarZoomData.url = ctx.message.text.trim()
    ctx.session.webinarStep = 'zoom_only_date'
    return ctx.reply(
      '📅 <b>Шаг 2/2: На какую дату эта ссылка?</b>\n<i>Например: 4 мая</i>',
      { parse_mode: 'HTML', ...cancelKeyboard }
    )
  }

  // ── zoom_only шаг 2: получить дату и применить ────────────────────────────
  if (step === 'zoom_only_date') {
    const zoomUrl = ctx.session.webinarZoomData.url
    const parsed  = parseDateOnly(ctx.message.text)
    ctx.session.webinarZoomOnly = false

    if (!parsed) {
      return ctx.reply('❌ Не могу распознать дату. Введите в формате <i>"4 мая"</i>:', { parse_mode: 'HTML' })
    }

    await ctx.reply('⏳ Обновляю записи...')

    try {
      const messages = await getMessages()

      // Найти записи с совпадающей датой рассылки (по дню и месяцу, Israel TZ)
      const toUpdate = messages.filter(m => {
        const sendTimeStr = m.fields['Время рассылки']
        if (!sendTimeStr) return false
        const mt = moment.tz(sendTimeStr, 'Asia/Jerusalem')
        return mt.date() === parsed.day && (mt.month() + 1) === parsed.month
      })

      for (const rec of toUpdate) {
        await updateMessage(rec.id, { 'ZOOM_URL': zoomUrl })
        console.log(`[Webinar Zoom] Updated ${rec.id} (${rec.fields['Тариф']} @ ${rec.fields['Время рассылки']})`)
      }

      // Проверить: ссылка получена менее чем за 24ч до вебинара?
      // Оцениваем время вебинара как наибольшее sendTime + 15 мин
      let sentAccess = 0
      if (toUpdate.length > 0) {
        const latestSend = Math.max(...toUpdate.map(r => new Date(r.fields['Время рассылки']).getTime()))
        const webinarApprox = latestSend + 15 * 60 * 1000
        const hoursLeft = (webinarApprox - Date.now()) / (1000 * 60 * 60)

        if (hoursLeft < 24) {
          const allMembers = await getClubMembers()
          const targets    = filterTargets(allMembers, 'ДОСТУП')
          for (const member of targets) {
            const tgId = member.fields['telegram_id']
            if (!tgId) continue
            try {
              await ctx.telegram.sendMessage(
                String(tgId),
                `🔗 Ссылка на вебинар готова!\n${zoomUrl}`,
                { link_preview_options: { is_disabled: true } }
              )
              sentAccess++
            } catch (e) {
              console.error(`[Webinar Zoom] sendMessage failed for ${tgId}:`, e.message)
            }
          }
        }
      }

      await ctx.reply(
        `✅ Обновлено ${toUpdate.length} записей рассылки` +
        (sentAccess > 0 ? `, отправлено ${sentAccess} участникам с оплаченным доступом` : '')
      )
    } catch (err) {
      console.error('[Webinar Zoom] Error:', err)
      await ctx.reply('❌ Ошибка: ' + err.message)
    }

    return ctx.scene.enter('ADMIN_MENU')
  }

  // ── Шаг 1: дата и время ───────────────────────────────────────────────────
  if (step === 1) {
    const m = parseWebinarDate(ctx.message.text)
    if (!m) {
      return ctx.reply('❌ Не могу распознать дату. Введите в формате <i>"4 мая 19:00"</i>:', { parse_mode: 'HTML' })
    }
    data.dateText = ctx.message.text.trim()
    data.dateIso  = m.toISOString()
    ctx.session.webinarStep = 2
    return ctx.reply(
      '📝 <b>Создание вебинара</b>\n\nШаг 2/6: Введите заголовок вебинара:',
      { parse_mode: 'HTML', ...cancelKeyboard }
    )
  }

  // ── Шаг 2: заголовок ──────────────────────────────────────────────────────
  if (step === 2) {
    data.title = ctx.message.text.trim()
    ctx.session.webinarStep = 3
    return ctx.reply(
      '🎤 <b>Создание вебинара</b>\n\nШаг 3/6: Введите имя ведущего:',
      { parse_mode: 'HTML', ...cancelKeyboard }
    )
  }

  // ── Шаг 3: ведущий ────────────────────────────────────────────────────────
  if (step === 3) {
    data.speaker = ctx.message.text.trim()
    ctx.session.webinarStep = 4
    return ctx.reply(
      '📋 <b>Создание вебинара</b>\n\nШаг 4/6: Введите тему / описание (что узнают участники):',
      { parse_mode: 'HTML', ...cancelKeyboard }
    )
  }

  // ── Шаг 4: описание ───────────────────────────────────────────────────────
  if (step === 4) {
    data.description = ctx.message.text.trim()
    ctx.session.webinarStep = 5
    return ctx.reply(
      '🔗 <b>Создание вебинара</b>\n\nШаг 5/6: Введите ссылку на Zoom:\n<i>Отправьте `-` если ссылки пока нет</i>',
      { parse_mode: 'HTML', ...cancelKeyboard }
    )
  }

  // ── Шаг 5: Zoom URL ───────────────────────────────────────────────────────
  if (step === 5) {
    const input = ctx.message.text.trim()
    data.zoomUrl = input === '-' ? null : input
    ctx.session.webinarStep = 6
    return showPriceConfirm(ctx)
  }

  // ── Шаг 6: ввод изменённых цен ───────────────────────────────────────────
  if (step === 6) {
    const parts    = ctx.message.text.trim().split(/\s+/)
    const base     = parseFloat(parts[0])
    const practice = parseFloat(parts[1])
    if (isNaN(base) || isNaN(practice) || base <= 0 || practice <= 0) {
      return ctx.reply(
        '❌ Введите две суммы через пробел, например: <code>50 30</code>',
        { parse_mode: 'HTML' }
      )
    }
    data.priceBase     = base
    data.pricePractice = practice
    ctx.session.webinarStep = 7
    return showPreview(ctx)
  }
})

// ── Хелперы отображения ───────────────────────────────────────────────────────

async function showPriceConfirm(ctx) {
  const data = ctx.session.webinarData
  await ctx.reply(
    `💰 <b>Шаг 6/6 — Суммы доплат:</b>\n\n` +
    `• Доступ для БАЗА: ₪${data.priceBase}\n` +
    `• ПРАКТИКА (запись): ₪${data.pricePractice}\n\n` +
    `Подтвердить или ввести новые суммы?`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Подтвердить', 'webinar:prices_ok')],
        [Markup.button.callback('✏️ Изменить', 'webinar:prices_edit')],
        [Markup.button.callback('❌ Отменить', 'webinar:cancel')],
      ])
    }
  )
}

async function showPreview(ctx) {
  const d = ctx.session.webinarData
  await ctx.reply(
    `📋 <b>Проверьте данные вебинара:</b>\n\n` +
    `📅 Дата: ${escapeHtml(d.dateText)}\n` +
    `📝 Заголовок: ${escapeHtml(d.title)}\n` +
    `🎤 Ведущий: ${escapeHtml(d.speaker)}\n` +
    `📋 Описание: ${escapeHtml(d.description)}\n` +
    `🔗 Zoom: ${escapeHtml(d.zoomUrl) || 'не указан'}\n` +
    `💰 Доступ БАЗА: ₪${d.priceBase}\n` +
    `💰 Запись ПРАКТИКА: ₪${d.pricePractice}`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Создать', 'webinar:confirm')],
        [Markup.button.callback('❌ Отмена',  'webinar:cancel')],
      ])
    }
  )
}

// ── Inline-кнопки ─────────────────────────────────────────────────────────────

adminWebinarScene.action('webinar:prices_ok', async (ctx) => {
  await ctx.answerCbQuery()
  ctx.session.webinarStep = 7
  return showPreview(ctx)
})

adminWebinarScene.action('webinar:prices_edit', async (ctx) => {
  await ctx.answerCbQuery()
  ctx.session.webinarStep = 6
  const d = ctx.session.webinarData
  await ctx.reply(
    `✏️ Введите новые суммы через пробел:\n` +
    `<i>Сначала БАЗА, потом ПРАКТИКА. Например: <code>${d.priceBase} ${d.pricePractice}</code></i>`,
    { parse_mode: 'HTML', ...cancelKeyboard }
  )
})

adminWebinarScene.action('webinar:confirm', async (ctx) => {
  await ctx.answerCbQuery()
  const d        = ctx.session.webinarData
  const telegram = ctx.telegram   // захватываем для использования в setTimeout

  await ctx.reply('⏳ Создаю вебинар...')

  try {
    // ── Платёжные ссылки ─────────────────────────────────────────────────────
    const linkBase     = buildPaymentUrl(process.env.ALLPAY_LINK_BASE,     { clientName: '', clientEmail: '', telegramId: '' })
    const linkPractice = buildPaymentUrl(process.env.ALLPAY_LINK_PRACTICE, { clientName: '', clientEmail: '', telegramId: '' })
    console.log(`[Webinar] Payment link БАЗА: ${linkBase}`)
    console.log(`[Webinar] Payment link ПРАКТИКА: ${linkPractice}`)

    // ── Вспомогательные переменные ───────────────────────────────────────────
    const dateMatch = d.dateText.match(/^(.+)\s+(\d{1,2}:\d{2})$/)
    const datePart  = dateMatch ? dateMatch[1] : d.dateText
    const timePart  = dateMatch ? dateMatch[2] : ''

    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const zoom          = d.zoomUrl
    const zoomLine      = zoom ? `<a href="${zoom}">Ссылка на Zoom</a>\n` : ''
    const zoomOrLater   = zoom ? `<a href="${zoom}">Ссылка на Zoom</a>` : 'Ссылка на Zoom придёт позже'
    const zoomOrContact = zoom ? `<a href="${zoom}">Ссылка на Zoom</a>` : 'уточните у @where_is_themoney'

    // ── Времена рассылки ──────────────────────────────────────────────────────
    const t24h = moment.tz(d.dateIso, 'Asia/Jerusalem').subtract(24, 'hours')
    const t1h  = moment.tz(d.dateIso, 'Asia/Jerusalem').subtract(1, 'hour')
    const t15m = moment.tz(d.dateIso, 'Asia/Jerusalem').subtract(15, 'minutes')

    // ── Тексты сообщений ──────────────────────────────────────────────────────

    const textBase24 =
      `Привет! 👋 Завтра, ${datePart} в ${timePart} — вебинар «${esc(d.title)}» с ${esc(d.speaker)}. ` +
      `${esc(d.description)} ` +
      `Хотите присоединиться онлайн или получить запись — доплата ${d.priceBase}₪: 👉 <a href="${linkBase}">Оплатить</a> ` +
      `Есть вопросы? Пишите @where_is_themoney`

    const textPractice24 =
      `Привет! 👋 Завтра, ${datePart} в ${timePart} — вебинар «${esc(d.title)}» с ${esc(d.speaker)}. ` +
      `${esc(d.description)} ` +
      `Запись в ваш тариф не входит, но можно исправить — ${d.pricePractice}₪: 👉 <a href="${linkPractice}">Оплатить</a> ` +
      `${zoomLine}` +
      `Есть вопросы? Пишите @where_is_themoney`

    const textPractice1h =
      `Привет! Через час — вебинар «${esc(d.title)}» с ${esc(d.speaker)}. ` +
      `Запись не входит в ваш тариф — ${d.pricePractice}₪: 👉 <a href="${linkPractice}">Оплатить</a> ` +
      `${zoomOrLater} ` +
      `Есть вопросы? Пишите @where_is_themoney`

    const textPractice15m =
      `Через 15 минут начинаем! 🎙 «${esc(d.title)}» с ${esc(d.speaker)}. ` +
      `${zoomOrContact} ` +
      `Запись в ваш тариф не входит. Хотите сохранить — доплата ${d.pricePractice}₪: 👉 <a href="${linkPractice}">Оплатить</a> ` +
      `Есть вопросы или не получается подключиться? Пишите @where_is_themoney`

    const textAccess24 =
      `Привет! 👋 Завтра, ${datePart} в ${timePart} — вебинар «${esc(d.title)}» с ${esc(d.speaker)}. ` +
      `${esc(d.description)} ` +
      `${zoomLine}` +
      `Есть вопросы? Пишите @where_is_themoney`

    const textAccess1h =
      `Привет! Через час — вебинар «${esc(d.title)}» с ${esc(d.speaker)}. ` +
      `${zoomOrLater} ` +
      `Есть вопросы? Пишите @where_is_themoney`

    const textAccess15m =
      `Через 15 минут начинаем! 🎙 «${esc(d.title)}» с ${esc(d.speaker)}. ` +
      `${zoomOrContact} ` +
      `Есть вопросы или не получается подключиться? Пишите @where_is_themoney`

    // ── Создание 7 записей в MESSAGE table + планирование отправки ────────────
    const records = [
      { text: textBase24,      tariff: 'БАЗА',     sendTime: t24h.format(), zoomUrl: zoom },
      { text: textPractice24,  tariff: 'ПРАКТИКА', sendTime: t24h.format(), zoomUrl: zoom },
      { text: textPractice1h,  tariff: 'ПРАКТИКА', sendTime: t1h.format(),  zoomUrl: zoom },
      { text: textPractice15m, tariff: 'ПРАКТИКА', sendTime: t15m.format(), zoomUrl: zoom },
      { text: textAccess24,    tariff: 'ДОСТУП',   sendTime: t24h.format(), zoomUrl: zoom },
      { text: textAccess1h,    tariff: 'ДОСТУП',   sendTime: t1h.format(),  zoomUrl: zoom },
      { text: textAccess15m,   tariff: 'ДОСТУП',   sendTime: t15m.format(), zoomUrl: zoom },
    ]

    for (const rec of records) {
      const created  = await createMessage({
        text:     rec.text,
        tariff:   rec.tariff,
        sendTime: rec.sendTime,
        zoomUrl:  rec.zoomUrl || null,
        send:     true,
      })
      const recordId = created?.record?.id
      const label    = moment.tz(rec.sendTime, 'Asia/Jerusalem').format('DD.MM HH:mm')
      console.log(`[Webinar] Created: ${rec.tariff} @ ${label} | id: ${recordId}`)

      // Поставить setTimeout если время рассылки в будущем
      const delay = new Date(rec.sendTime).getTime() - Date.now()
      if (delay > 0 && recordId) {
        setTimeout(async () => {
          try {
            await clearSendFlag(recordId)
            const allMembers = await getClubMembers()
            const targets    = filterTargets(allMembers, rec.tariff)
            for (const member of targets) {
              try {
                await telegram.sendMessage(String(member.fields['telegram_id']), rec.text, {
                  parse_mode: 'HTML',
                  link_preview_options: { is_disabled: true }
                })
              } catch (e) {
                console.error(`[Webinar] Send failed for ${member.fields['telegram_id']}:`, e.message)
              }
            }
            console.log(`[Webinar] Sent ${rec.tariff} @ ${label} → ${targets.length} members`)

            // БАЗА 24h → пометить вебинар как активный
            if (rec.tariff === 'БАЗА') {
              try {
                await updateMessage(recordId, { Active: true })
                console.log(`[Webinar] Set Active=true for БАЗА message ${recordId}`)
              } catch (e) {
                console.error(`[Webinar] Failed to set Active=true:`, e.message)
              }
            }

            // 15-минутное сообщение → деактивировать все записи этого вебинара
            if (rec.text.startsWith('Через 15 минут')) {
              try {
                const thisSend = new Date(rec.sendTime).getTime()
                const allMsgs = await getMessages()
                const toDeactivate = allMsgs.filter(m => {
                  const t = m.fields['Время рассылки']
                  if (!t) return false
                  return Math.abs(new Date(t).getTime() - thisSend) <= 25 * 60 * 60 * 1000
                })
                for (const r of toDeactivate) {
                  await updateMessage(r.id, { Active: false })
                }
                console.log(`[Webinar] Set Active=false on ${toDeactivate.length} webinar records`)
              } catch (e) {
                console.error(`[Webinar] Failed to deactivate webinar records:`, e.message)
              }
            }
          } catch (e) {
            console.error(`[Webinar] Scheduled send error (${rec.tariff} @ ${label}):`, e.message)
          }
        }, delay)
        console.log(`[Webinar] Scheduled ${rec.tariff} message for ${label}`)
      }
    }

    await ctx.reply(
      `✅ <b>Вебинар создан!</b>\n\n` +
      `📋 Записей в MESSAGE table: 7\n\n` +
      `⏰ Расписание рассылок:\n` +
      `• ${t24h.tz('Asia/Jerusalem').format('DD.MM в HH:mm')} — за 24ч (БАЗА, ПРАКТИКА, ДОСТУП)\n` +
      `• ${t1h.tz('Asia/Jerusalem').format('DD.MM в HH:mm')} — за 1ч (ПРАКТИКА, ДОСТУП)\n` +
      `• ${t15m.tz('Asia/Jerusalem').format('DD.MM в HH:mm')} — за 15мин (ПРАКТИКА, ДОСТУП)\n\n` +
      `🔗 Ссылка БАЗА: ${escapeHtml(linkBase)}\n` +
      `📹 Ссылка ПРАКТИКА: ${escapeHtml(linkPractice)}`,
      { parse_mode: 'HTML' }
    )
  } catch (err) {
    console.error('[Webinar] Create error:', err)
    await ctx.reply('❌ Ошибка при создании вебинара: ' + err.message)
  }

  return ctx.scene.enter('ADMIN_MENU')
})

adminWebinarScene.action('webinar:cancel', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('❌ Отменено')
  return ctx.scene.enter('ADMIN_MENU')
})
