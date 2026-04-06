import 'dotenv/config'
import { Telegraf } from 'telegraf'
import { getClubMembers } from '../integrations/fillout.js'

const BOT_TOKEN = process.env.BOT_TOKEN
const GROUP_ID = -1003528829419

async function scan() {
  const bot = new Telegraf(BOT_TOKEN)

  const admins = await bot.telegram.getChatAdministrators(GROUP_ID)
  const humanAdmins = admins.filter(a => !a.user.is_bot)

  const clubMembers = await getClubMembers()

  const results = []

  for (const admin of humanAdmins) {
    const user = admin.user
    const telegramName = `${user.first_name || ''} ${user.last_name || ''}`.trim()
    const telegramUsername = user.username ? user.username.toLowerCase() : null

    for (const member of clubMembers) {
      const filloutName = (member.fields['Имя, фамилия'] || '').toLowerCase()
      const filloutNick = (member.fields['Ник в ТГ'] || '').toLowerCase()
      const filloutTelegramId = member.fields['telegram_id']

      // Уже есть ID — пропускаем
      if (filloutTelegramId) continue

      let matchType = null

      if (telegramUsername && filloutNick.includes(telegramUsername)) {
        matchType = 'username'
      } else if (telegramName && filloutName === telegramName.toLowerCase()) {
        matchType = 'name (exact)'
      } else if (telegramName.length > 4 && filloutName &&
                 (filloutName.includes(telegramName.toLowerCase()) || telegramName.toLowerCase().includes(filloutName))) {
        matchType = 'name (partial)'
      }

      if (matchType) {
        results.push({ user, member, matchType })
      }
    }
  }

  console.log(`\n📋 Найдено совпадений где в Fillout НЕТ telegram_id: ${results.length}\n`)
  console.log('═'.repeat(100))

  for (const { user, member, matchType } of results) {
    const f = member.fields
    const tgName = `${user.first_name || ''} ${user.last_name || ''}`.trim()
    const tgUser = user.username ? `@${user.username}` : 'нет'

    console.log(`\n👤 TELEGRAM:  ${tgName} | ${tgUser} | ID: ${user.id}`)
    console.log(`   FILLOUT:   ${f['Имя, фамилия']} | ${f['Электронная почта '] || '—'} | ник: ${f['Ник в ТГ'] || '—'} | ID: ${f['telegram_id'] ?? 'нет'}`)
    console.log(`   Совпало:   ${matchType}`)
    console.log(`   Record ID: ${member.id}`)
  }

  console.log('\n' + '═'.repeat(100))
  console.log(`\nИтого: ${results.length} записей в Fillout без telegram_id, совпавших с админами группы`)
  console.log('✅ DRY RUN — ничего не записано\n')

  process.exit(0)
}

scan().catch(e => { console.error(e); process.exit(1) })
