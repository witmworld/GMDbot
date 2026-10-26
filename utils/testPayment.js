// Признаки тестового платежа — для таких платежей кабала не выписывается.
//
// В теле вебхука AllPay отдельного флага test mode нет (список полей —
// allpay_api_reference_llm.md, раздел 3.2 Payment Webhook), поэтому признаков два:
//  1. слово «тест»/«test»/«טסט» в имени заказа, позициях, имени, e-mail клиента;
//  2. карта из документированного списка тестовых карт (раздел Test Cards) —
//     в вебхуке приходит card_mask вида 455743******3431: сверяем первые 6 и
//     последние 4 цифры.
// Слово ищется с начала слова: «тестовый» подходит, «протест»/«contest» — нет.

const TEST_WORD = /(?<![\p{L}\p{N}])(тест|test|טסט)/iu

// Успешные тестовые карты AllPay: Visa, Mastercard, American Express.
const TEST_CARDS = ['4557430402053431', '5326105300985846', '375516193000090']

function maskMatchesTestCard(mask) {
  const digits = String(mask || '').replace(/[\s-]/g, '')
  const m = digits.match(/^(\d{4,6})\**(\d{4})$/)
  if (!m) return false
  return TEST_CARDS.some(c => c.startsWith(m[1]) && c.endsWith(m[2]))
}

// Возвращает строку-причину или null, если платёж не похож на тестовый.
export function detectTestPayment(body = {}) {
  const texts = [
    body.name,
    body.client_name,
    body.client_email,
    ...(Array.isArray(body.items) ? body.items.map(i => i?.name) : []),
  ]
  for (const t of texts) {
    if (t && TEST_WORD.test(String(t))) return `слово «тест» в данных: ${String(t).slice(0, 60)}`
  }
  if (maskMatchesTestCard(body.card_mask)) return `тестовая карта ${body.card_mask}`
  return null
}
