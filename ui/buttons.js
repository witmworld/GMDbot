export const Buttons = {
  // Global
  uploadDocuments: () => ({ text: '📎 Загрузить документы', callback_data: 'go:documents' }),
  goTariffs: () => ({ text: '📋 Перейти к выбору тарифа', callback_data: 'go:tariffs' }),
  askMore: () => ({ text: '❓ Задать ещё вопрос', callback_data: 'go:ask' }),
  back: (scene) => ({ text: '⬅️ Назад', callback_data: `back:${scene}` }),

  // Tariffs
  tariff: (code, title) => ({ text: title, callback_data: `tariff:${code}` }),
  helpChoose: () => ({ text: '❓ Помоги выбрать', callback_data: 'tariff:help' }),

  // Period
  period: (code, title) => ({ text: title, callback_data: `period:${code}` }),

  // Confirm
  confirmOk: () => ({ text: '✅ Подтвердить и перейти к оплате', callback_data: 'confirm:ok' }),

  // Documents
  docType: (code, title) => ({ text: title, callback_data: `doc:${code}` }),
  docsBackToMenu: () => ({ text: '⬅️ Назад', callback_data: 'go:menu' })
}