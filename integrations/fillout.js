import fetch from 'node-fetch'

const BASE_URL = 'https://tables.fillout.com/api/v1'
const FILLOUT_API_KEY = process.env.FILLOUT_API_KEY
const FILLOUT_DATABASE_ID = process.env.FILLOUT_DATABASE_ID
const FILLOUT_TABLE_ID = process.env.FILLOUT_TABLE_ID
const CLUB_TABLE_ID    = 'tkDXcWAVooU'
const MESSAGE_TABLE_ID = process.env.FILLOUT_MESSAGE_TABLE_ID || 't5tVm2Fai29'

async function getRecords() {
  const url = `${BASE_URL}/bases/${FILLOUT_DATABASE_ID}/tables/${FILLOUT_TABLE_ID}/records/list`

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FILLOUT_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    })
  } catch (e) {
    console.error('[Fillout] fetch failed:', e.message, e.response ?? null)
    throw e
  }

  const data = await res.json()

  if (!data.records) {
    throw new Error(`Fillout API error: ${JSON.stringify(data)}`)
  }

  return data.records
}

function mapRecord(r) {
  return {
    type: r.fields['Payment Type'],
    term: r.fields.PERIOD,
    name: r.fields.Name,
    amount: r.fields.Amount
  }
}

export async function getTariffs() {
  const records = await getRecords()
  return records
    .filter(r => r.fields['Payment Type'] === 'TARIFF')
    .map(mapRecord)
}

export async function getAccess() {
  const records = await getRecords()
  return records
    .filter(r => r.fields['Payment Type'] === 'ACCESS')
    .map(mapRecord)
}

export async function getDocuments() {
  const records = await getRecords()
  return records
    .filter(r => r.fields['Payment Type'] === 'DOCUMENTS')
    .map(mapRecord)
}

export async function getClubMembers(tableId = CLUB_TABLE_ID) {
  console.log('[Verify] Fetching from table:', tableId)
  const url = `${BASE_URL}/bases/${FILLOUT_DATABASE_ID}/tables/${tableId}/records/list`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FILLOUT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })
  const data = await res.json()
  if (!data.records) throw new Error(`Fillout getClubMembers error: ${JSON.stringify(data)}`)
  console.log('[Verify] Found records:', data.records.length)
  console.log('[Verify] Sample records:', JSON.stringify(data.records.slice(0, 3), null, 2))
  return data.records
}

export async function getMembersByTariffs(tariffs) {
  const allMembers = await getClubMembers()
  const includeAll     = tariffs.includes('КЛУБ')
  const includePremium = tariffs.includes('ПРЕМИУМ')
  const specific = tariffs.filter(t => t !== 'КЛУБ' && t !== 'ПРЕМИУМ')

  const seen = new Set()
  const result = []
  for (const m of allMembers) {
    const tgId       = m.fields['telegram_id']
    const userTariff = m.fields['Тариф']
    if (!tgId) continue
    if (seen.has(tgId)) continue

    let include = false
    if (includeAll) include = true
    else if (includePremium && userTariff !== 'БАЗА') include = true
    else if (specific.includes(userTariff)) include = true

    if (include) {
      seen.add(tgId)
      result.push(m)
    }
  }
  return result
}

export async function getClubMember(telegramId) {
  const members = await getClubMembers()
  return members.find(m => String(m.fields['telegram_id']) === String(telegramId))?.fields || null
}

export async function getClubMemberRecord(telegramId) {
  const members = await getClubMembers()
  return members.find(m => String(m.fields['telegram_id']) === String(telegramId)) || null
}

export async function setMemberAdminFlag(recordId) {
  const url = `${BASE_URL}/bases/${FILLOUT_DATABASE_ID}/tables/${CLUB_TABLE_ID}/records/${recordId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${FILLOUT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ record: { 'Админ': true } }),
  })
  const data = await res.json()
  if (res.status >= 400) throw new Error(`setMemberAdminFlag error: ${JSON.stringify(data)}`)
  return data
}

export async function getMessages() {
  const url = `${BASE_URL}/bases/${FILLOUT_DATABASE_ID}/tables/${MESSAGE_TABLE_ID}/records/list`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FILLOUT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })
  const data = await res.json()
  if (!data.records) throw new Error(`Fillout getMessages error: ${JSON.stringify(data)}`)
  if (data.records.length > 0) {
    console.log('[Scheduler] Message table fields:', Object.keys(data.records[0].fields))
  }
  return data.records
}

export async function clearSendFlag(recordId) {
  const url = `${BASE_URL}/bases/${FILLOUT_DATABASE_ID}/tables/${MESSAGE_TABLE_ID}/records/${recordId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${FILLOUT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ record: { 'send': false } }),
  })
  const data = await res.json()
  console.log('[Scheduler] clearSendFlag response:', res.status, JSON.stringify(data))
  return data
}

export async function createClubMember({ first_name, last_name, username, user_id }) {
  const url = `${BASE_URL}/bases/${FILLOUT_DATABASE_ID}/tables/${CLUB_TABLE_ID}/records`
  const name = `${first_name || ''} ${last_name || ''}`.trim()
  const nick = username ? `@${username}` : (first_name || '')

  const record = {
    'Имя, фамилия': name,
    'Ник в ТГ': nick,
    'telegram_id': Number(user_id),
    'Добавился в чат': 'да',
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FILLOUT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ record }),
  })

  const data = await res.json()
  if (res.status >= 400) throw new Error(`createClubMember error: ${JSON.stringify(data)}`)
  console.log('Created record for:', name, 'ID:', user_id)
  return data
}

export async function updateClubMemberFields(recordId, fields) {
  const url = `${BASE_URL}/bases/${FILLOUT_DATABASE_ID}/tables/${CLUB_TABLE_ID}/records/${recordId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${FILLOUT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ record: fields }),
  })
  const data = await res.json()
  if (res.status >= 400) throw new Error(`updateClubMemberFields error: ${JSON.stringify(data)}`)
  return data
}

export async function updateClubMemberTelegram(recordId, telegramUsername, telegramId, email = null) {
  const url = `${BASE_URL}/bases/${FILLOUT_DATABASE_ID}/tables/${CLUB_TABLE_ID}/records/${recordId}`
  // Fillout API requires { "record": { ...fields } }, NOT { "fields": { ... } }
  const record = { telegram_id: Number(telegramId) }
  if (telegramUsername) record['Ник в ТГ'] = `@${telegramUsername}`
  if (email) record['Электронная почта'] = email

  const body = JSON.stringify({ record })
  console.log('[Fillout] PATCH', url)
  console.log('[Fillout] Request body:', body)

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${FILLOUT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body,
  })

  const data = await res.json()
  console.log('[Fillout] Response status:', res.status)
  console.log('[Fillout] Response body:', JSON.stringify(data))
  return data
}
