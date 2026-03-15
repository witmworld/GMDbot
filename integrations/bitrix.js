import fetch from 'node-fetch'

const ADD_URL = process.env.ADD_URL

const UPDATE_URL = process.env.UPDATE_URL

const LIST_URL = process.env.LIST_URL

const BASE_TITLE = 'Клуб «Где мои деньги»'

function normalizePhone(phone = '') {
  return String(phone).replace(/\D/g, '')
}

async function bitrixPost(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  const data = await res.json()
  return data
}

async function findLeadByPhone(phoneDigits) {
  const payload = {
    filter: {
      PHONE: phoneDigits,
      TITLE: BASE_TITLE
    },
    select: ['ID', 'TITLE']
  }

  const data = await bitrixPost(LIST_URL, payload)
  return data.result?.[0] || null
}

export async function updateLead(id, ctx) {
  const payload = {
    id,
    fields: {
      TITLE: BASE_TITLE,
      UF_CRM_1674059477: ctx.session.orderId || '',
      COMMENTS: `
Источник: Telegram бот
Username: @${ctx.from.username || '—'}
Telegram ID: ${ctx.from.id}

Тариф: ${ctx.session.tariff || '—'}
Период: ${ctx.session.period || '—'}
      `.trim()
    }
  }

  const data = await bitrixPost(UPDATE_URL, payload)

  if (!data.result) {
    throw new Error(`Bitrix update failed: ${JSON.stringify(data)}`)
  }

  ctx.session.bitrixLeadId = id
  return id
}

async function addLead(ctx, phoneDigits) {
  const payload = {
    fields: {
      TITLE: BASE_TITLE,
      NAME: ctx.from.first_name || '',
      LAST_NAME: ctx.from.last_name || '',
      PHONE: [{ VALUE: phoneDigits, VALUE_TYPE: 'WORK' }],
      EMAIL: [{ VALUE: ctx.session.email, VALUE_TYPE: 'WORK' }],
      UF_CRM_1674059477: ctx.session.orderId || '',
      SOURCE_DESCRIPTION: 'Telegram бот',
      COMMENTS: `
Источник: Telegram бот
Username: @${ctx.from.username || '—'}
Telegram ID: ${ctx.from.id}

Тариф: ${ctx.session.tariff || '—'}
Период: ${ctx.session.period || '—'}
      `.trim()
    }
  }

  const data = await bitrixPost(ADD_URL, payload)

  if (!data.result) {
    throw new Error(`Bitrix add failed: ${JSON.stringify(data)}`)
  }

  ctx.session.bitrixLeadId = data.result
  return data.result
}

export async function updateLeadFields(leadId, fields) {
  const payload = { id: leadId, fields }
  const data = await bitrixPost(UPDATE_URL, payload)
  if (!data.result) {
    throw new Error(`Bitrix field update failed: ${JSON.stringify(data)}`)
  }
  return leadId
}

export async function findLeadByOrderId(orderId) {
  const payload = {
    filter: {
      UF_CRM_1674059477: orderId,
      TITLE: BASE_TITLE
    },
    select: ['ID', 'TITLE', 'UF_CRM_1674059477']
  }

  const data = await bitrixPost(LIST_URL, payload)
  return data.result?.[0] || null
}

export async function updateLeadPaymentStatus(leadId, paymentData) {
  const payload = {
    id: leadId,
    fields: {
      UF_CRM_1730301346: true,
      STATUS_ID: 'CONVERTED',
      COMMENTS: `
Оплата подтверждена
ORDER_ID: ${paymentData.order_id || '—'}
Сумма: ${paymentData.amount || '—'}
Дата оплаты: ${new Date().toISOString()}
Transaction ID: ${paymentData.transaction_id || '—'}
      `.trim()
    }
  }

  const data = await bitrixPost(UPDATE_URL, payload)

  if (!data.result) {
    throw new Error(`Bitrix payment update failed: ${JSON.stringify(data)}`)
  }

  return leadId
}

/**
 * Загрузка файла в поле UF_CRM_1492519109 лида
 */
export async function uploadDocumentToLead(leadId, fileName, base64Data) {
  const fields = {
    UF_CRM_1492519109: [{ fileData: [fileName, base64Data] }]
  }
  return await updateLeadFields(leadId, fields)
}

/**
 * ✅ ГЛАВНЫЙ ЭКСПОРТ
 * Upsert лида: list → update / add
 */
export async function createOrUpdateBitrixLead(ctx) {
  const phoneDigits = normalizePhone(ctx.session.phone)

  // если уже сохранили — просто обновляем
  if (ctx.session.bitrixLeadId) {
    return await updateLead(ctx.session.bitrixLeadId, ctx)
  }

  // ищем по телефону + TITLE
  const existing = await findLeadByPhone(phoneDigits)

  if (existing?.ID) {
    return await updateLead(existing.ID, ctx)
  }

  // не нашли — создаём
  return await addLead(ctx, phoneDigits)
}