import {
  getClubMemberRecord,
  findOrCreateClubMember,
  updateClubMemberFields,
  getMessages,
} from '../integrations/fillout.js'
import {
  findLeadByOrderId,
  updateLeadPaymentStatus,
  updateLeadFields,
} from '../integrations/bitrix.js'
import { createReceipt } from '../integrations/greeninvoice.js'

// Живёт отдельно от index.js, чтобы payment.scene.js могло вызвать
// processTariffPayment напрямую (100%-скидка купоном, минуя AllPay) без
// циклического импорта: index.js сам импортирует payment.scene.js и на
// верхнем уровне поднимает Express-сервер — заворачивать этот файл обратно
// через index.js в сцену слишком рискованно для платёжного пути.
export function toIsoDate(date) {
  const dd   = String(date.getDate()).padStart(2, '0')
  const mm   = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = date.getFullYear()
  return `${yyyy}-${mm}-${dd}`
}

// Постоплатная цепочка тарифной подписки — вынесена из /payment/webhook, чтобы
// её же можно было вызвать напрямую при 100%-скидке купоном (payment.scene.js),
// минуя AllPay. Поведение самого webhook не меняется: он просто зовёт эту
// функцию с тем же body, что получал раньше.
//
// body.name ожидается в виде "Тариф — период" (как и раньше) или
// "Тариф — период — купон КОД" — третий сегмент опционален и добавляется
// только когда покупка сделана по купону (см. payment.scene.js).
export async function processTariffPayment(bot, body) {
  const telegramId = body.add_field || body.order_id.split('_')[0]
  try {
    // Участник CLUB — ДО Bitrix, чтобы при сбое Bitrix участник уже был записан.
    // Разбор body.name нужен здесь же (Тариф/Подписка/код купона).
    let clubMember = null
    let couponCode = null
    if (body.name && telegramId && !/доступ|вебинар/i.test(body.name)) {
      const nameParts = body.name.split(' — ')
      const tariffTitle = nameParts[0] || ''
      const subscription = nameParts[1] || ''
      const couponMatch = (nameParts[2] || '').match(/^купон (.+)$/)
      couponCode = couponMatch ? couponMatch[1] : null

      try {
        clubMember = await findOrCreateClubMember({
          telegramId,
          email: body.client_email,
          phone: body.client_phone,
          name: body.client_name || '',
          tariffTitle,
          subscription,
        })
        console.log(`[Webhook] CLUB member ready for telegramId ${telegramId}: ${clubMember.id}`)
      } catch (err) {
        console.error(`[Webhook] CLUB member find/create failed for telegramId ${telegramId}:`, err.message)
      }

      // Фиксация использования купона: код ДОБАВЛЯЕТСЯ к уже накопленным через
      // запятую, не перезаписывает.
      if (clubMember && couponCode) {
        try {
          const prevCodes = clubMember.fields?.['COUPON'] || ''
          const nextCodes = prevCodes ? `${prevCodes}, ${couponCode}` : couponCode
          await updateClubMemberFields(clubMember.id, {
            'COUPON': nextCodes,
            'COUPON FROM': toIsoDate(new Date()),
          })
          console.log(`[Webhook] Recorded coupon usage: ${couponCode} for telegramId: ${telegramId}`)
        } catch (err) {
          console.error(`[Webhook] Coupon usage record failed for telegramId ${telegramId}:`, err.message)
        }
      }
    }

    const lead = await findLeadByOrderId(body.order_id)
    if (lead?.ID) {
      await updateLeadPaymentStatus(lead.ID, body)
    }

    const amount = Number(body.amount) || 0

    // Купон на 100% даёт нулевую сумму — GreenInvoice такую не примет, кабалу
    // не выписываем вовсе (это единственное отличие от обычной оплаты).
    if (amount > 0) {
      try {
        const receipt = await createReceipt({
          clientName: body.client_name || '',
          clientEmail: body.client_email || '',
          clientPhone: body.client_phone || '',
          amount,
          description: body.name || 'Оплата клуб ГМД',
          orderId: body.order_id
        })

        const receiptUrl = receipt.receipt_url || receipt.url || receipt.shareUrl || ''
        if (receiptUrl && lead?.ID) {
          await updateLeadFields(lead.ID, { UF_CRM_1734183234: receiptUrl })
        }

        if (receiptUrl && telegramId) {
          await bot.telegram.sendMessage(
            telegramId,
            `תודה! 🙏\nקבלה נשלחה לאימייל שלך.\nלצפייה בקבלה: ${receiptUrl}`
          )
        }
      } catch (err) {
        console.error('❌ Ошибка создания квитанции GreenInvoice:', err)
      }
    } else {
      console.log(`[Webhook] Skipping receipt creation for zero-amount order: ${body.order_id}`)
    }

    if (/доступ|вебинар/i.test(body.name || '') && telegramId) {
      console.log(`[Webhook] Access payment for telegramId: ${telegramId}`)
      try {
        const memberRecord = await getClubMemberRecord(telegramId)
        if (memberRecord) {
          const dateStr = toIsoDate(new Date())
          await updateClubMemberFields(memberRecord.id, { 'Вебинар': dateStr })
          console.log(`[Webhook] Updated Вебинар field for telegramId: ${telegramId} → ${dateStr}`)
        }
        const messages = await getMessages()
        const activeWebinar = messages.find(m => m.fields['Active'] === true && m.fields['ZOOM_URL'])
        const zoomUrl = activeWebinar?.fields['ZOOM_URL'] || null
        const webinarMsg = zoomUrl
          ? `✅ Оплата получена!\nСсылка на вебинар: ${zoomUrl}`
          : '✅ Оплата получена!\nСсылка на Zoom придёт вам в боте незадолго до начала вебинара.'
        await bot.telegram.sendMessage(telegramId, webinarMsg)
      } catch (err) {
        console.error(`[Webhook] Webinar update failed for telegramId ${telegramId}:`, err.message)
      }
    }
  } catch (err) {
    console.error('❌ Ошибка обновления лида после оплаты:', err)
  }
}
