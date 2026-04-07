import fetch from 'node-fetch'

const BASE_URL = 'https://api.greeninvoice.co.il/api/v1'
const GREENINVOICE_ID = process.env.GREENINVOICE_ID
const GREENINVOICE_SECRET = process.env.GREENINVOICE_SECRET

let cachedToken = null
let tokenExpiresAt = 0

export async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken
  }

  const res = await fetch(`${BASE_URL}/account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: GREENINVOICE_ID,
      secret: GREENINVOICE_SECRET
    })
  })

  const data = await res.json()

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

export async function cancelGreenInvoiceDocument(documentId) {
  const token = await getToken()

  console.log('[GreenInvoice Cancel] documentId:', JSON.stringify(documentId), 'length:', documentId.length)

  const res = await fetch(`${BASE_URL}/documents/${documentId}/cancel`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({})
  })

  const data = await res.json()

  if (data.errorCode) {
    console.log('[GreenInvoice Cancel] Error response:', res.status, JSON.stringify(data))
    throw new Error(`GreenInvoice cancel failed: ${data.errorCode} — ${data.errorMessage}`)
  }

  return data
}