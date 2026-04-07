import fetch from 'node-fetch'

const BASE_URL = 'https://api.greeninvoice.co.il/api/v1'
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

  const res = await fetch(`${BASE_URL}/account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: GREENINVOICE_ID,
      secret: GREENINVOICE_SECRET
    })
  })

  console.log('[GreenInvoice Token] Response status:', res.status)

  const data = await res.json()

  console.log('[GreenInvoice Token] token received:', !!data.token)

  if (!data.token) {
    throw new Error(`GreenInvoice auth failed: ${JSON.stringify(data)}`)
  }

  cachedToken = data.token
  // обновляем за 5 минут до истечения (токен живёт ~30 мин)
  tokenExpiresAt = Date.now() + 25 * 60 * 1000

  return cachedToken
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

  const data = await res.json()

  if (data.errorCode) {
    throw new Error(`GreenInvoice receipt failed: ${data.errorCode} — ${data.errorMessage}`)
  }

  return data
}

export async function cancelGreenInvoiceDocument({ id, name, email, amount }) {
  const token = await getToken()

  console.log('[GreenInvoice Cancel] documentId:', JSON.stringify(id), 'length:', id.length)
  console.log('[GreenInvoice Cancel] client name:', name, '| email:', email, '| amount:', amount)
  console.log('[GreenInvoice Cancel] Creating זיכוי (type 410) for linkedDocumentId:', id)

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
        name:  name || '',
        email: email || 'email@gmail.com',
        add:   false
      },
      income: [
        {
          description: 'ביטול קבלה',
          quantity: 1,
          price: amount || 0,
          currency: 'ILS',
          vatType: 0
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