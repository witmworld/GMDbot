/**
 * sync-admins.js
 * Запускать периодически для синхронизации админов Telegram группы с Fillout CLUB table.
 *
 * Логика:
 *   1. Получить список admin-ов группы (без ботов)
 *   2. Получить все записи из Fillout
 *   3. Для каждого админа:
 *      a. Уже есть запись с этим telegram_id → пропустить (уже в системе)
 *      b. Найдена запись БЕЗ telegram_id по username (exact) или имени (exact) → обновить ID
 *      c. Найдена запись БЕЗ telegram_id только по partial match → создать новую запись
 *      d. Вообще не найден в Fillout → создать новую запись
 */

import 'dotenv/config'
import { Telegraf } from 'telegraf'
import fetch from 'node-fetch'

const BASE_URL     = 'https://tables.fillout.com/api/v1'
const API_KEY      = process.env.FILLOUT_API_KEY
const DATABASE_ID  = process.env.FILLOUT_DATABASE_ID
const CLUB_TABLE   = 'tkDXcWAVooU'
const GROUP_ID     = -1003528829419

// ─── Fillout helpers ────────────────────────────────────────────────────────

async function getMembers() {
  const res = await fetch(
    `${BASE_URL}/bases/${DATABASE_ID}/tables/${CLUB_TABLE}/records/list`,
    { method: 'POST', headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, body: '{}' }
  )
  const data = await res.json()
  if (!data.records) throw new Error('Fillout error: ' + JSON.stringify(data))
  return data.records
}

async function patchTelegramId(recordId, telegramId, username) {
  const record = { telegram_id: telegramId }
  if (username) record['Ник в ТГ'] = `@${username}`
  const res = await fetch(
    `${BASE_URL}/bases/${DATABASE_ID}/tables/${CLUB_TABLE}/records/${recordId}`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ record }) }
  )
  const data = await res.json()
  if (res.status >= 400) throw new Error(JSON.stringify(data))
  return data
}

async function createMember({ name, username, telegramId }) {
  const res = await fetch(
    `${BASE_URL}/bases/${DATABASE_ID}/tables/${CLUB_TABLE}/records`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ record: {
        'Имя, фамилия':    name,
        'Ник в ТГ':        username ? `@${username}` : name,
        'telegram_id':     telegramId,
        'Добавился в чат': 'да',
      }}),
    }
  )
  const data = await res.json()
  if (res.status >= 400) throw new Error(JSON.stringify(data))
  return data
}

// ─── Matching ────────────────────────────────────────────────────────────────

function findMatch(user, members) {
  const tgName     = `${user.first_name || ''} ${user.last_name || ''}`.trim().toLowerCase()
  const tgUsername = user.username?.toLowerCase()

  for (const m of members) {
    const filloutNick = (m.fields['Ник в ТГ'] || '').toLowerCase().replace(/^@/, '')
    const filloutName = (m.fields['Имя, фамилия'] || '').toLowerCase()

    // username exact
    if (tgUsername && filloutNick === tgUsername) return { member: m, type: 'username' }
    // name exact
    if (tgName && filloutName === tgName)         return { member: m, type: 'name_exact' }
  }

  // partial — only if no exact found
  for (const m of members) {
    const filloutName = (m.fields['Имя, фамилия'] || '').toLowerCase()
    if (tgName.length > 4 && filloutName &&
        (filloutName.includes(tgName) || tgName.includes(filloutName))) {
      return { member: m, type: 'partial' }
    }
  }

  return null
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run() {
  const bot = new Telegraf(process.env.BOT_TOKEN)

  console.log('🔄 Синхронизация админов группы → Fillout\n')

  console.log('[1/3] Получаю список админов из Telegram...')
  const all    = await bot.telegram.getChatAdministrators(GROUP_ID)
  const admins = all.filter(a => !a.user.is_bot)
  console.log(`      Найдено: ${admins.length} человек (${all.length - admins.length} ботов пропущено)\n`)

  console.log('[2/3] Загружаю записи из Fillout...')
  const members = await getMembers()
  console.log(`      Записей в таблице: ${members.length}\n`)

  // Индекс по telegram_id для быстрой проверки "уже есть"
  const existingIds = new Set(
    members.map(m => m.fields['telegram_id']).filter(Boolean).map(String)
  )

  console.log('[3/3] Обрабатываю каждого админа...\n')
  console.log('═'.repeat(80))

  const stats = { skipped: 0, updated: 0, created: 0, errors: 0 }
  const report = { skipped: [], updated: [], created: [], errors: [] }

  for (const admin of admins) {
    const user    = admin.user
    const tgName  = `${user.first_name || ''} ${user.last_name || ''}`.trim()
    const tgUser  = user.username ? `@${user.username}` : 'нет'

    await new Promise(r => setTimeout(r, 150))

    // a. Уже есть telegram_id в таблице
    if (existingIds.has(String(user.id))) {
      console.log(`⏭  ${tgName} (${tgUser}) — уже в системе`)
      stats.skipped++
      report.skipped.push(tgName)
      continue
    }

    const membersWithoutId = members.filter(m => !m.fields['telegram_id'])
    const match = findMatch(user, membersWithoutId)

    try {
      if (match && (match.type === 'username' || match.type === 'name_exact')) {
        // b. Точное совпадение — обновить
        await patchTelegramId(match.member.id, user.id, user.username)
        const filloutName = match.member.fields['Имя, фамилия']
        console.log(`✅  ${tgName} (${tgUser}) → обновлён [${filloutName}] (${match.type})`)
        stats.updated++
        report.updated.push(`${tgName} → ${filloutName}`)
      } else {
        // c/d. Partial или не найден — создать новую запись
        const reason = match ? `partial match: ${match.member.fields['Имя, фамилия']}` : 'не найден'
        await createMember({ name: tgName, username: user.username, telegramId: user.id })
        console.log(`➕  ${tgName} (${tgUser}) → новая запись (${reason})`)
        stats.created++
        report.created.push(`${tgName} (${tgUser})`)
      }
    } catch (err) {
      console.log(`❌  ${tgName}: ${err.message}`)
      stats.errors++
      report.errors.push(`${tgName}: ${err.message}`)
    }
  }

  console.log('\n' + '═'.repeat(80))
  console.log('📊 ИТОГ:')
  console.log(`   ⏭  Уже были в системе:  ${stats.skipped}`)
  console.log(`   ✅  Обновлено (ID добавлен): ${stats.updated}`)
  console.log(`   ➕  Создано новых записей:   ${stats.created}`)
  console.log(`   ❌  Ошибок:                  ${stats.errors}`)

  if (report.updated.length) {
    console.log('\n✅ Обновлены:')
    report.updated.forEach(r => console.log('   ' + r))
  }
  if (report.created.length) {
    console.log('\n➕ Созданы:')
    report.created.forEach(r => console.log('   ' + r))
  }
  if (report.errors.length) {
    console.log('\n❌ Ошибки:')
    report.errors.forEach(r => console.log('   ' + r))
  }

  process.exit(0)
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1) })
