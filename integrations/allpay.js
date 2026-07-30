import { createHash } from 'crypto'
import fetch from 'node-fetch'

const ALLPAY_LOGIN = process.env.ALLPAY_LOGIN
const ALLPAY_KEY = process.env.ALLPAY_KEY
const WEBHOOK_URL = `${process.env.WEBHOOK_DOMAIN}/payment/webhook`

// Постоянные публичные ссылки AllPay с зашитой суммой — не секреты.
// env оставлен необязательным переопределителем: если переменная не задана
// (или не долетела из Railway), используется значение по умолчанию.
export const ALLPAY_LINK_BASE     = process.env.ALLPAY_LINK_BASE     || 'https://allpay.to/~iim/8981a3'
export const ALLPAY_LINK_PRACTICE = process.env.ALLPAY_LINK_PRACTICE || 'https://allpay.to/~iim/82e03d'

/**
 * SHA256 подпись запроса:
 * 1. Сортировка ключей по алфавиту
 * 2. Для массива items — обход каждого элемента, ключи (name, price, qty, vat) тоже по алфавиту
 * 3. Конкатенация значений через ":"
 * 4. Добавление секретного ключа
 * 5. SHA256 хеш
 */
function createSignature(params) {
  const parts = []

  const sorted = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== '' && params[k] != null)
    .sort()

  for (const key of sorted) {
    const val = params[key]
    if (Array.isArray(val)) {
      for (const item of val) {
        const itemKeys = Object.keys(item).sort()
        for (const ik of itemKeys) {
          if (item[ik] !== '' && item[ik] != null) parts.push(item[ik])
        }
      }
    } else if (typeof val === 'object') {
      const objKeys = Object.keys(val).sort()
      for (const ok of objKeys) {
        if (val[ok] !== '' && val[ok] != null) parts.push(val[ok])
      }
    } else {
      parts.push(val)
    }
  }

  const str = parts.join(':')
  const signString = str + ':' + ALLPAY_KEY

  return createHash('sha256').update(signString).digest('hex')
}

/**
 * Проверка подписи входящего вебхука
 */
export function verifyWebhookSignature(params) {
  const received = params.sign
  if (!received) return false
  const computed = createSignature(params)
  return received === computed
}

export function buildPaymentUrl(baseUrl, { clientEmail, clientName, telegramId } = {}) {
  const params = new URLSearchParams()
  if (clientName)  params.set('client_name', clientName)
  if (clientEmail) params.set('client_email', clientEmail)
  if (telegramId)  params.set('add_field', String(telegramId))
  return `${baseUrl}?${params.toString()}`
}

/**
 * Создание платежа
 */
export async function createPaymentLink({ orderId, amount, description, successUrl, customerPhone, customerEmail }) {
  const data = await createPayment({ orderId, amount, description, successUrl, customerPhone, customerEmail })
  const url = data.url || data.payment_url || data.link || data.pay_url || ''
  if (!url) throw new Error('No payment URL in response: ' + JSON.stringify(data))
  return url
}

export async function createPayment({ orderId, amount, description, customerPhone, customerEmail, successUrl }) {
  const payload = {
    login: ALLPAY_LOGIN,
    order_id: orderId,
    items: [{ name: description, price: amount, qty: 1 }],
    webhook_url: WEBHOOK_URL,
    ...(successUrl ? { success_url: successUrl } : {}),
    client_phone: customerPhone,
    client_email: customerEmail
  }

  payload.sign = createSignature(payload)

  const response = await fetch('https://allpay.to/app/?show=getpayment&mode=api10', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  const data = await response.json()
  return data
}
