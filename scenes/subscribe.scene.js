import { Scenes, Markup } from 'telegraf'
import { getClubMembers, updateClubMemberTelegram } from '../integrations/fillout.js'

export const subscribeScene = new Scenes.BaseScene('SUBSCRIBE')

const ADMIN_ID = 867023416

const backButton = Markup.inlineKeyboard([
  [{ text: '⬅️ Назад', callback_data: 'back:MENU' }]
])

function normalizePhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10 && digits.startsWith('05')) {
    digits = '972' + digits.slice(1)       // 0501234567 → 972501234567
  } else if (digits.startsWith('0')) {
    digits = '972' + digits.slice(1)       // 08x... → 972x...
  } else if (digits.length === 9 && digits.startsWith('5')) {
    digits = '972' + digits               // 501234567 → 972501234567
  }
  // Remove spurious 0 after country code: 9720XXXXXXXXX → 972XXXXXXXXX
  if (digits.startsWith('9720')) {
    digits = '972' + digits.slice(4)
  }
  return digits
}

function last9(phone) {
  return phone.slice(-9)
}

// Шаг 1: запрос email
subscribeScene.enter(async (ctx) => {
  ctx.session.verifyEmail = null
  await ctx.reply('Введите ваш email', backButton)
})

subscribeScene.on('callback_query', async (ctx) => {
  await ctx.answerCbQuery()
  if (ctx.callbackQuery.data === 'back:MENU') return ctx.scene.enter('MENU')
})

subscribeScene.on('text', async (ctx) => {
  const input = ctx.message.text.trim()

  // Шаг 1 → получили email
  if (!ctx.session.verifyEmail) {
    if (!input.includes('@')) {
      return ctx.reply('Введите корректный email (должен содержать @)', backButton)
    }
    ctx.session.verifyEmail = input.toLowerCase()
    return ctx.reply('Введите номер телефона (в формате 972...)', backButton)
  }

  // Шаг 2 → получили телефон, ищем запись
  const emailLower = ctx.session.verifyEmail
  const phoneNorm  = normalizePhone(input)

  let records
  try {
    records = await getClubMembers()
  } catch (e) {
    console.error('[Verify] getClubMembers failed:', e.message)
    return ctx.reply('Ошибка при поиске. Попробуйте позже.', backButton)
  }

  const found = records.find(r => {
    console.log('Email from DB:', r.fields['Электронная почта'])
    const recEmail = String(
      r.fields['Электронная почта'] || r.fields['Электронная почта '] || r.fields['Email'] || ''
    ).toLowerCase()
    const recPhone   = normalizePhone(r.fields['Телефон'])
    const emailMatch = recEmail === emailLower
    const phoneMatch = phoneNorm.length > 0 && recPhone.length > 0 &&
                       last9(phoneNorm) === last9(recPhone)
    return emailMatch || phoneMatch
  })

  ctx.session.verifyEmail = null

  if (!found) {
    console.error('Verification failed:', emailLower, phoneNorm)
    const u = ctx.from
    const adminMsg =
      `❌ Не найден в базе:\n` +
      `Имя: ${u.first_name || ''} ${u.last_name || ''}\n` +
      `Email: ${emailLower}\n` +
      `Телефон: ${phoneNorm}\n` +
      `Username: @${u.username || '—'}\n` +
      `Telegram ID: ${u.id}`
    ctx.telegram.sendMessage(ADMIN_ID, adminMsg).catch(() => {})
    return ctx.reply(
      'Email или телефон не найдены в базе клуба. Обратитесь к администратору',
      backButton
    )
  }

  const name = found.fields['Name'] || found.fields['Имя'] || ctx.from.first_name
  console.log('Verification success:', name)

  const u = ctx.from
  const myUsername  = ctx.from.username
  const recordEmail = String(
    found.fields['Электронная почта'] || found.fields['Электронная почта '] || ''
  ).trim()
  const emailToFill = !recordEmail ? emailLower : null

  // Always notify admin
  const adminMsg =
    `✅ Верификация:\n` +
    `Имя: ${u.first_name || ''} ${u.last_name || ''}\n` +
    `Запись: ${name}\n` +
    `Email: ${emailLower}\n` +
    `Телефон: ${phoneNorm}\n` +
    `Username: @${u.username || '—'}\n` +
    `ID: ${u.id}`
  ctx.telegram.sendMessage(ADMIN_ID, adminMsg).catch(() => {})

  // Always update — ensures telegram_id is saved even if nick already matched
  try {
    await updateClubMemberTelegram(found.id, myUsername, u.id, emailToFill)
  } catch (e) {
    console.error('[Verify] updateClubMemberTelegram failed:', e.message)
  }

  await ctx.reply(
    'Данные обновлены! Теперь ваш Telegram привязан к аккаунту клуба ✅',
    backButton
  )
})
