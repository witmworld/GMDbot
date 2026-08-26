import { Buttons } from './buttons.js'
import { DOCUMENTS_DATA } from '../content/documents.data.js'

export const Keyboards = {
  aiAfterAnswer: () => ({
    inline_keyboard: [
      [Buttons.askMore()],
      [Buttons.goTariffs()],
      [Buttons.back('MENU')]
    ]
  }),

  tariffsCompact: () => ({
    inline_keyboard: [
      [Buttons.tariff('base', 'База')],
      [Buttons.tariff('practice', 'Практика')],
      [Buttons.tariff('practice_plus', 'Практика +')],
      [Buttons.tariff('support', 'Сопровождение')],
      [Buttons.back('MENU')]
    ]
  }),

  tariffsFull: () => ({
    inline_keyboard: [
      [Buttons.tariff('base', 'База')],
      [Buttons.tariff('practice', 'Практика')],
      [Buttons.tariff('practice_plus', 'Практика +')],
      [Buttons.tariff('support', 'Сопровождение')],
      [Buttons.helpChoose()],
      [Buttons.back('MENU')]
    ]
  }),

  periodMenu: () => ({
    inline_keyboard: [
      [Buttons.period('month', '💳 Месяц')],
      [Buttons.period('year', '💳 Год')],
      [Buttons.back('TARIFF')]
    ]
  }),

  confirmMenu: () => ({
    inline_keyboard: [
      [Buttons.confirmOk()],
      [Buttons.coupon()],
      [Buttons.back('PERIOD')]
    ]
  }),

  couponPreviewMenu: () => ({
    inline_keyboard: [
      [Buttons.couponApply()],
      [Buttons.couponDecline()]
    ]
  }),

  documentsMenu: () => ({
    inline_keyboard: [
      ...DOCUMENTS_DATA.map(d => [Buttons.docType(d.code, d.title)]),
      [Buttons.back('MENU')]
    ]
  })
}
