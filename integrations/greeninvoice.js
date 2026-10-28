import fetch from 'node-fetch'

// Официально подтверждено (developers.morning.co/docs/openapi.bundled.json,
// схема CreateDocumentResponse для POST /documents — Add Document): ответ
// всегда содержит объект url: { origin, he, en }, поле url обязательно.
// origin — исходная ссылка на документ; en присутствует, только если lang
// был 'en'. Полей receipt_url и shareUrl в схеме нет и не было — старый код
// (receipt.receipt_url || receipt.url || receipt.shareUrl) обращался к двум
// несуществующим полям и в итоге получал сам объект url, откуда и был
// receipt: [object Object] в логах.
export function extractReceiptUrl(receipt) {
  const url = receipt?.url
  if (!url) return ''
  return url.origin || url.he || url.en || ''
}

export function extractReceiptNumber(receipt) {
  return receipt?.number ?? ''
}

const BASE_URL = 'https://api.greeninvoice.co.il/api/v1'
const TOKEN_URL = 'https://api.morning.co/idp/v1/oauth/token'
const GREENINVOICE_ID = process.env.GREENINVOICE_ID
const GREENINVOICE_SECRET = process.env.GREENINVOICE_SECRET

let cachedToken = null
let tokenExpiresAt = 0

export async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    console.log('[GreenInvoice Token] Using cached token')
    return cachedToken
  }

  console.log('[GreenInvoice Token] Requesting new token...')

  // Старый POST /api/v1/account/token удалён (404 с пустым телом, с 17.10.2026
  // выписка кабалот молча падала). Актуальная авторизация — OAuth2
  // client_credentials, developers.morning.co/docs/openapi.bundled.json,
  // POST /idp/v1/oauth/token (сервер https://api.morning.co); ответ
  // { accessToken, tokenType, expiresAt (unix, сек) }, токен живёт 1 час.
  // Остальные эндпоинты остаются на BASE_URL.
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: GREENINVOICE_ID,
      client_secret: GREENINVOICE_SECRET
    })
  })

  console.log('[GreenInvoice Token] Response status:', res.status)

  // Тело читаем как текст: пустой ответ (как у удалённого эндпоинта) должен
  // давать понятную ошибку со статусом, а не «Unexpected end of JSON input».
  const text = await res.text()
  let data = {}
  try { data = JSON.parse(text) } catch {}

  console.log('[GreenInvoice Token] token received:', !!data.accessToken)

  if (!data.accessToken) {
    throw new Error(`GreenInvoice auth failed: HTTP ${res.status} ${text.slice(0, 200)}`)
  }

  cachedToken = data.accessToken
  // обновляем за 5 минут до истечения (токен живёт 1 час)
  tokenExpiresAt = data.expiresAt
    ? data.expiresAt * 1000 - 5 * 60 * 1000
    : Date.now() + 55 * 60 * 1000

  return cachedToken
}

export async function getDocument(id) {
  const token = await getToken()

  const res = await fetch(`${BASE_URL}/documents/${id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  })

  const data = await res.json()

  if (res.status >= 400 || data.errorCode) {
    throw new Error(`GreenInvoice getDocument failed: ${data.errorCode ?? res.status} — ${data.errorMessage ?? JSON.stringify(data)}`)
  }

  return data
}

export async function createReceipt({ clientName, clientEmail, clientPhone, amount, description, orderId }) {
  const token = await getToken()

  const income = [
    {
      description: description || 'תרומה',
      quantity: 1,
      price: amount
    }
  ]
  const res = await fetch(`${BASE_URL}/documents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      type: 405,
      lang: 'he',
      currency: 'ILS',
      vatType: 0,
      remarks: orderId ? `ORDER_ID: ${orderId}` : '',
      client: {
        name: clientName || '',
        emails: clientEmail ? [clientEmail] : [],
        phones: { mobile: clientPhone || '' }
      },
      income,
      payment: [
        {
          type: 3,
          price: amount,
          date: new Date().toISOString().split('T')[0]
        }
      ]
    })
  })

  const text = await res.text()
  let data = {}
  try { data = JSON.parse(text) } catch {}

  // Успех — HTTP 201. Ответ 4xx бывает с errorCode: 0 и пустым сообщением,
  // поэтому смотрим на статус, а не только на errorCode.
  if (!res.ok || data.errorCode) {
    throw new Error(`GreenInvoice receipt failed: HTTP ${res.status}, ${data.errorCode ?? '-'} — ${data.errorMessage || text.slice(0, 300) || 'пустой ответ'}`)
  }

  return data
}

export async function cancelGreenInvoiceDocument({ id, amount }) {
  console.log('[GreenInvoice Cancel] documentId:', JSON.stringify(id), 'length:', id.length)

  // Имя из Excel непригодно: колонка לקוח для многих строк пуста в XML,
  // а ивритские значения — мохибейк win1255. Кириллица в выгрузке Morning
  // невосстановима в принципе (win1255 не может её представить), поэтому
  // Excel даёт только id и сумму. Клиент запрашивается из исходного документа.
  const original = await getDocument(id)
  const client = original.client

  if (!client || !client.name) {
    throw new Error(`Нет client.name в исходном документе ${id} — зикуй не создаётся`)
  }

  console.log('[GreenInvoice Cancel] client from original document:', JSON.stringify(client))
  console.log('[GreenInvoice Cancel] Creating זיכוי (type 410) for linkedDocumentId:', id)

  const token = await getToken()

  const res = await fetch(`${BASE_URL}/documents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      type: 410,
      linkedDocumentId: id,
      lang: 'he',
      signed: true,
      currency: 'ILS',
      client: {
        name:   client.name,
        // Плейсхолдер, не реальный e-mail клиента (CLAUDE.md) — иначе
        // GreenInvoice разошлёт клиенту письмо о служебной операции отмены.
        emails: ['cancel@cancel.com'],
        phone:  client.phone || '',
        add:    false
      },
      income: [
        {
          description: 'ביטול קבלה',
          quantity: 1,
          price: amount || 0,
          currency: 'ILS',
          vatType: 0
        }
      ],
      payment: [
        {
          type: 3,
          price: amount || 0,
          date: new Date().toISOString().split('T')[0]
        }
      ]
    })
  })

  const data = await res.json()

  console.log('[GreenInvoice Cancel] Response status:', res.status, '| errorCode:', data.errorCode ?? 'none')

  if (data.errorCode) {
    console.log('[GreenInvoice Cancel] Error response:', res.status, JSON.stringify(data))
    throw new Error(`GreenInvoice cancel failed: ${data.errorCode} — ${data.errorMessage}`)
  }

  return data
}