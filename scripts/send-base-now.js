import 'dotenv/config'
import { Telegraf } from 'telegraf'
import { getClubMembers } from '../integrations/fillout.js'
import { createPaymentLink } from '../integrations/allpay.js'

function hasActiveWebinarAccess(member) {
  const raw = member.fields['Вебинар']
  if (!raw) return false
  let paid
  if (raw.includes('T') || raw.includes('-')) {
    paid = new Date(raw)
  } else {
    const [dd, mm, yyyy] = raw.split('/')
    if (!dd || !mm || !yyyy) return false
    paid = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd))
  }
  if (isNaN(paid.getTime())) return false
  const diffDays = (Date.now() - paid.getTime()) / (1000 * 60 * 60 * 24)
  return diffDays <= 30
}

async function main() {
  console.log('[send-base-now] Starting...')

  const bot = new Telegraf(process.env.BOT_TOKEN)

  // 1. Получить всех участников
  const allMembers = await getClubMembers()
  console.log(`[send-base-now] Total members: ${allMembers.length}`)

  // 2. Все уникальные значения поля Тариф
  const allTariffs = [...new Set(allMembers.map(m => m.fields['Тариф']))]
  console.log('[send-base-now] All unique Тариф values:', JSON.stringify(allTariffs))

  // Дополнительно — с trimmed uppercase для диагностики
  const allTariffsNormalized = [...new Set(
    allMembers.map(m => (m.fields['Тариф'] ?? '').trim().toUpperCase())
  )]
  console.log('[send-base-now] Normalized Тариф values:', JSON.stringify(allTariffsNormalized))

  // 3. Фильтр: тариф БАЗА (оба варианта)
  const baseMembers = allMembers.filter(m => {
    const raw = m.fields['Тариф']
    if (!raw) return false
    return raw === 'БАЗА' || raw.trim().toUpperCase() === 'БАЗА'
  })
  console.log(`[send-base-now] БАЗА members: ${baseMembers.length}`)

  // 4. Исключить тех у кого Вебинар заполнен не старше 30 дней
  const targets = baseMembers.filter(m => !hasActiveWebinarAccess(m))
  console.log(`[send-base-now] Targets after excluding active webinar: ${targets.length}`)

  // Исключённые
  const excluded = baseMembers.filter(m => hasActiveWebinarAccess(m))
  if (excluded.length > 0) {
    console.log(`[send-base-now] Excluded (active webinar): ${excluded.map(m => m.fields['telegram_id'] || m.fields['Имя, фамилия']).join(', ')}`)
  }

  // 5–6. Для каждого с telegram_id — создать ссылку и отправить
  let sent = 0
  let skipped = 0

  for (const member of targets) {
    const tgId = member.fields['telegram_id']
    if (!tgId) {
      console.log(`[send-base-now] No telegram_id for: ${member.fields['Имя, фамилия'] || member.id}`)
      skipped++
      continue
    }

    const customerEmail = member.fields['Электронная почта '] || ''
    const customerPhone = member.fields['Телефон'] || ''
    const orderId = `${tgId}_webinar_base_${Date.now()}`

    let paymentUrl
    try {
      paymentUrl = await createPaymentLink({
        description: 'Доступ на вебинар - БАЗА',
        amount: 50,
        orderId,
        customerEmail,
        customerPhone,
      })
      console.log(`[send-base-now] Payment link for ${tgId}: ${paymentUrl}`)
    } catch (e) {
      console.error(`[send-base-now] createPaymentLink failed for ${tgId}:`, e.message)
      skipped++
      continue
    }

    const text = `Привет! 👋 Сегодня в 19:00 — вебинар «Возврат налогов для наёмных работников» с Игорем Лупинским.\n\nХотите присоединиться онлайн или получить запись — доплата 50₪:\n👉 <a href="${paymentUrl}">Оплатить</a>\n\nЕсть вопросы? Пишите @where_is_themoney`

    try {
      await bot.telegram.sendMessage(String(tgId), text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      })
      console.log(`[send-base-now] Sent to ${tgId}`)
      sent++
    } catch (e) {
      console.error(`[send-base-now] sendMessage failed for ${tgId}:`, e.message)
      skipped++
    }
  }

  console.log(`[send-base-now] Done. Sent: ${sent}, Skipped/Failed: ${skipped}`)
  process.exit(0)
}

main().catch(e => {
  console.error('[send-base-now] Fatal error:', e)
  process.exit(1)
})
