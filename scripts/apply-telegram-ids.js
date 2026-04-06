import 'dotenv/config'
import fetch from 'node-fetch'

const BASE_URL = 'https://tables.fillout.com/api/v1'
const FILLOUT_API_KEY = process.env.FILLOUT_API_KEY
const FILLOUT_DATABASE_ID = process.env.FILLOUT_DATABASE_ID
const CLUB_TABLE_ID = 'tkDXcWAVooU'

// ── 100% совпадения (username exact / name exact) ──────────────────────────
const TO_UPDATE = [
  { recordId: 'b5f14f92-6a2a-4107-9870-ea7ca59c6306', telegramId: 1356215070,  name: 'Hila Antebi',              username: '@Lilu_lilu12' },
  { recordId: '43de6ef5-23b0-419b-bf33-a506cff4430a', telegramId: 287624106,   name: 'Olga Tverdokhlib',         username: '@OlgaTverdokhlib' },
  { recordId: '4aae2e5d-24d0-4e4c-86fc-4f8c05a2c724', telegramId: 6537342498,  name: 'Tanya',                    username: '@chami_sh' },
  { recordId: '994d4c69-03cc-48a1-875d-e8a3708049f7', telegramId: 8236938343,  name: 'Сергей Исаков',            username: null },
  { recordId: '8577efd1-6150-4bfa-bc8b-d1196a2096d3', telegramId: 1341907401,  name: 'Екатерина Каневская',      username: '@KanevskiKaterina' },
  { recordId: 'a90f5da2-f10b-4036-9b5a-48e5b2157e27', telegramId: 6150685518,  name: 'Alex (повышение эфф.)',    username: '@alex_ku_pro' },
  { recordId: 'e36cd204-62e8-423a-9d9a-28608acbcefb', telegramId: 576473834,   name: 'Inna Filatova',            username: '@ifilatova67' },
  { recordId: '60eb9479-f537-4a9f-bc4f-3ef9c9dcda23', telegramId: 1443793786,  name: 'Виктория Абрамова',        username: '@Vita1976' },
  { recordId: '2886e38f-fd96-4209-acb9-94e9891c07de', telegramId: 1111935058,  name: 'Евгения Рейзин',           username: '@Evgeniya_Reizin' },
  { recordId: '24ec40b0-aeee-4244-ac33-40c43a0f58a5', telegramId: 514301963,   name: 'Vasisulis',                username: '@Vasisulis' },
  { recordId: '931b1892-4cd7-43b6-8350-2867cfac4a2a', telegramId: 668416574,   name: 'евгения',                  username: '@evgenochkaldm' },
  { recordId: '42a78ca0-d310-4171-a33c-7e680cfe7345', telegramId: 1698533813,  name: 'Olga Fleitman',            username: '@OlgaFleitman' },
  { recordId: '3481df95-9e6f-48cc-a681-4039efa04cb5', telegramId: 1670163498,  name: 'Tania T.',                 username: '@colorfae' },
  { recordId: '68b8dc62-f097-4cd7-ba6a-2c3fdeeb628a', telegramId: 5167394223,  name: 'Anna Solo',                username: '@soloannasolo' },
  { recordId: 'cc834540-f5ad-4628-aab7-617ac1216c0f', telegramId: 269779193,   name: 'Yulia Gutkina',            username: '@YuliaGutkina' },
  { recordId: 'd35cd9f1-67ef-418d-a976-4772f73a627b', telegramId: 5151356569,  name: 'Людмила Колесникова',      username: '@MilaKol15' },
  { recordId: '6db7761a-0741-41df-a703-427626692b05', telegramId: 758159258,   name: 'Marina.jewels.israel',     username: '@marinajewelsisrael' },
  { recordId: 'db4a280e-274e-4258-ad86-6b4ff02debe2', telegramId: 879359988,   name: 'Женя / Евгений Фишер',    username: '@evgenyf5' },
  { recordId: '33b41a2d-8155-4f3d-bccf-795d8f698ee5', telegramId: 1590113378,  name: 'Anna Filatova',            username: '@annafilatova89' },
  { recordId: '2ae65485-d5a9-41db-8536-5a7c51598742', telegramId: 5161861487,  name: 'Tatiana Dubrovin',         username: '@TDubrovin' },
  { recordId: '41c2f9a9-8579-4d08-9989-d0f79f437bb9', telegramId: 1150816767,  name: 'N K / Наталья Кантарович', username: '@Nnnn_Kkkkkkk' },
  { recordId: '8c465588-9c2e-45f6-baf2-abec75fdcf7c', telegramId: 336804986,   name: 'Maria Krasilova',          username: '@mariakrasilova' },
]

// ── Сомнительные — создать новые записи ───────────────────────────────────
const TO_CREATE = [
  { first_name: 'Юлия', last_name: 'Зарипова', username: null, user_id: 1524888539 },
]

async function patchRecord(recordId, telegramId, username) {
  const url = `${BASE_URL}/bases/${FILLOUT_DATABASE_ID}/tables/${CLUB_TABLE_ID}/records/${recordId}`
  const record = { 'telegram_id': telegramId }
  if (username) record['Ник в ТГ'] = username

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${FILLOUT_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ record }),
  })
  const data = await res.json()
  if (res.status >= 400) throw new Error(JSON.stringify(data))
  return data
}

async function createRecord({ first_name, last_name, username, user_id }) {
  const url = `${BASE_URL}/bases/${FILLOUT_DATABASE_ID}/tables/${CLUB_TABLE_ID}/records`
  const name = `${first_name || ''} ${last_name || ''}`.trim()
  const nick = username ? `@${username}` : (first_name || '')

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${FILLOUT_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ record: {
      'Имя, фамилия': name,
      'Ник в ТГ': nick,
      'telegram_id': Number(user_id),
      'Добавился в чат': 'да',
    }}),
  })
  const data = await res.json()
  if (res.status >= 400) throw new Error(JSON.stringify(data))
  return data
}

async function run() {
  console.log('🚀 Применяю telegram_id в Fillout\n')

  // 1. Обновления
  console.log(`📝 Обновляю ${TO_UPDATE.length} записей (100% совпадение):\n`)
  let updOk = 0, updErr = 0
  for (const { recordId, telegramId, name, username } of TO_UPDATE) {
    try {
      await patchRecord(recordId, telegramId, username)
      console.log(`   ✅ ${name} → ID ${telegramId}`)
      updOk++
    } catch (err) {
      console.log(`   ❌ ${name}: ${err.message}`)
      updErr++
    }
    await new Promise(r => setTimeout(r, 150))
  }

  // 2. Создание новых
  console.log(`\n➕ Создаю ${TO_CREATE.length} новых записей (сомнительные):\n`)
  let crOk = 0, crErr = 0
  for (const user of TO_CREATE) {
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim()
    try {
      await createRecord(user)
      console.log(`   ✅ ${name} → ID ${user.user_id}`)
      crOk++
    } catch (err) {
      console.log(`   ❌ ${name}: ${err.message}`)
      crErr++
    }
    await new Promise(r => setTimeout(r, 150))
  }

  console.log(`
════════════════════════════════
📊 Итог:
   Обновлено:  ${updOk}/${TO_UPDATE.length}
   Создано:    ${crOk}/${TO_CREATE.length}
   Ошибок:     ${updErr + crErr}
════════════════════════════════`)
}

run().catch(e => { console.error(e); process.exit(1) })
