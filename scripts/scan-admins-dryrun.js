import 'dotenv/config'
import { Telegraf } from 'telegraf'
import { getClubMembers, CLUB_FIELD_EMAIL, CLUB_FIELD_TELEGRAM_ID } from '../integrations/fillout.js'

const BOT_TOKEN = process.env.BOT_TOKEN
const GROUP_ID = -1003528829419

async function scanAdmins() {
  console.log('🔍 Scanning group admins (DRY RUN - no database writes)')
  console.log('Group ID:', GROUP_ID)
  console.log('')

  const bot = new Telegraf(BOT_TOKEN)

  try {
    // 1. Получить админов из Telegram
    console.log('[1/3] Getting admins from Telegram...')
    const admins = await bot.telegram.getChatAdministrators(GROUP_ID)
    const humanAdmins = admins.filter(a => !a.user.is_bot)

    console.log(`Found ${humanAdmins.length} human admins (${admins.length} total, ${admins.length - humanAdmins.length} bots)`)
    console.log('')

    // 2. Получить всех участников из Fillout
    console.log('[2/3] Getting members from Fillout CLUB table...')
    const clubMembers = await getClubMembers()
    console.log(`Found ${clubMembers.length} members in Fillout`)
    console.log('')

    // 3. Проверить каждого админа
    console.log('[3/3] Matching admins with Fillout members...')
    console.log('═'.repeat(80))
    console.log('')

    const found = []
    const notFound = []

    for (const admin of humanAdmins) {
      const user = admin.user
      const telegramName = `${user.first_name || ''} ${user.last_name || ''}`.trim()
      const telegramUsername = user.username ? `@${user.username}` : null

      console.log(`👤 Checking: ${telegramName} (${telegramUsername || 'no username'}) [ID: ${user.id}]`)

      const matches = findMatches(user, clubMembers)

      if (matches.length > 0) {
        found.push({ user, matches })
        console.log(`   ✅ FOUND ${matches.length} match(es):`)
        matches.forEach(m => {
          const fields = m.member.fields
          console.log(`      - ${fields['Имя, фамилия'] || ''} | ${fields[CLUB_FIELD_EMAIL] || ''} | ${fields['Ник в ТГ'] || ''}`)
          console.log(`        Matched by: ${m.matchType}`)
        })
      } else {
        notFound.push(user)
        console.log(`   ❌ NOT FOUND in Fillout`)
      }
      console.log('')
    }

    // 4. Итоговый отчёт
    console.log('═'.repeat(80))
    console.log('📊 SUMMARY')
    console.log('═'.repeat(80))
    console.log(`Total admins scanned: ${humanAdmins.length}`)
    console.log(`Found in Fillout:     ${found.length}`)
    console.log(`NOT found in Fillout: ${notFound.length}`)
    console.log('')

    if (notFound.length > 0) {
      console.log('❌ NOT FOUND:')
      notFound.forEach(user => {
        const name = `${user.first_name || ''} ${user.last_name || ''}`.trim()
        const username = user.username ? `@${user.username}` : 'no username'
        console.log(`   - ${name} (${username}) [ID: ${user.id}]`)
      })
      console.log('')
    }

    console.log('✅ DRY RUN COMPLETE - No changes made to database')

  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }

  process.exit(0)
}

function findMatches(telegramUser, clubMembers) {
  const matches = []

  const telegramName = `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim().toLowerCase()
  const telegramUsername = telegramUser.username ? telegramUser.username.toLowerCase() : null
  const telegramId = telegramUser.id

  for (const member of clubMembers) {
    const filloutName = (member.fields['Имя, фамилия'] || '').toLowerCase()
    const filloutNick = (member.fields['Ник в ТГ'] || '').toLowerCase()
    const filloutTelegramId = member.fields[CLUB_FIELD_TELEGRAM_ID]

    let matchType = null

    // 1. Точное совпадение по telegram_id (приоритет)
    if (filloutTelegramId && String(filloutTelegramId) === String(telegramId)) {
      matchType = 'telegram_id (exact)'
    }
    // 2. Точное совпадение по нику
    else if (telegramUsername && filloutNick.includes(telegramUsername)) {
      matchType = 'username (exact)'
    }
    // 3. Полное совпадение по имени
    else if (telegramName && filloutName === telegramName) {
      matchType = 'name (exact)'
    }
    // 4. Частичное совпадение по имени
    else if (telegramName && filloutName &&
             (filloutName.includes(telegramName) || telegramName.includes(filloutName))) {
      matchType = 'name (partial)'
    }
    // 5. Совпадение по имени (first name)
    else if (telegramUser.first_name && filloutName.includes(telegramUser.first_name.toLowerCase())) {
      matchType = 'first name (partial)'
    }

    if (matchType) {
      matches.push({ member, matchType })
    }
  }

  return matches
}

scanAdmins()
