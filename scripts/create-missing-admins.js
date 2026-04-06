import 'dotenv/config'
import fetch from 'node-fetch'

const BASE_URL = 'https://tables.fillout.com/api/v1'
const FILLOUT_API_KEY = process.env.FILLOUT_API_KEY
const FILLOUT_DATABASE_ID = process.env.FILLOUT_DATABASE_ID
const CLUB_TABLE_ID = 'tkDXcWAVooU'

const MISSING = [
  { name: 'Yulia',                       username: null,              id: 1314343283 },
  { name: 'Luda K',                      username: null,              id: 5345329506 },
  { name: 'Diana',                        username: null,              id: 1748630042 },
  { name: 'Valerie Shtotland',           username: null,              id: 1147789793 },
  { name: 'Micha Nesher',                username: '@mnesher',        id: 5140452031 },
  { name: 'Iryna K',                     username: null,              id: 397474513  },
  { name: 'Diana Broitman',              username: '@dianabroitman',  id: 953040306  },
  { name: 'Genya',                        username: null,              id: 1350468259 },
  { name: 'Olesya Sh',                   username: null,              id: 945656178  },
  { name: 'Igor Lupinskiy',              username: '@FSIL2025',       id: 7869808891 },
]

async function run() {
  console.log(`➕ Создаю ${MISSING.length} новых записей...\n`)
  let ok = 0, err = 0

  for (const person of MISSING) {
    const nick = person.username || person.name
    try {
      const res = await fetch(
        `${BASE_URL}/bases/${FILLOUT_DATABASE_ID}/tables/${CLUB_TABLE_ID}/records`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${FILLOUT_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ record: {
            'Имя, фамилия': person.name,
            'Ник в ТГ':     nick,
            'telegram_id':  person.id,
            'Добавился в чат': 'да',
          }}),
        }
      )
      const data = await res.json()
      if (res.status >= 400) throw new Error(JSON.stringify(data))
      console.log(`   ✅ ${person.name} (${person.username || 'нет username'}) → ID ${person.id}`)
      ok++
    } catch (e) {
      console.log(`   ❌ ${person.name}: ${e.message}`)
      err++
    }
    await new Promise(r => setTimeout(r, 150))
  }

  console.log(`\n════════════════════════
📊 Итог: создано ${ok}/${MISSING.length}, ошибок ${err}`)
}

run().catch(e => { console.error(e); process.exit(1) })
