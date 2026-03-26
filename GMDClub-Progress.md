# 📋 GMD Club Bot — Статус проекта

**Последнее обновление:** 23 марта 2026  
**Deployment:** https://gmd-bot-production-9d5b.up.railway.app  
**GitHub:** witm-school/GMD-bot  
**Admin ID:** 867023416

---

## ✅ **ВЫПОЛНЕНО**

### **Основная инфраструктура**
- ✅ Railway deployment настроен и стабилен
- ✅ Webhook работает корректно
- ✅ GitHub репозиторий мигрирован (bizgenieyg → witm-school)
- ✅ Все environment variables настроены
- ✅ Health check endpoint: GET /health

### **Интеграции**
- ✅ **AllPay** — приём платежей, создание ссылок (login: pp1016941)
- ✅ **GreenInvoice** — автоматическое создание квитанций (קבלות)
- ✅ **Bitrix24** — CRM интеграция
- ✅ **Fillout** — база данных:
  - CLUB table (tkDXcWAVooU) — участники
  - TARIFF table (tazbFXH4Ub6) — тарифы
  - MESSAGE table (t5tVm2Fai29) — рассылки
- ✅ **Google Calendar** — создание событий и рассылка

### **Пользовательский функционал**
- ✅ Регистрация через /start → PHONE → EMAIL → MENU
- ✅ Верификация участников по email/телефону (scenes/subscribe.scene.js)
- ✅ Главное меню: Вступить в Клуб | Оплатить доступ | Загрузить документы | Верифицировать данные
- ✅ AI-помощник Миша (требует тестирования OpenAI credits)

### **Админ-функционал**
- ✅ **Админ-меню** (/admin_menu) с проверкой прав через Fillout "Админ" checkbox
- ✅ **Админ Кабала** — массовая выписка квитанций из Excel:
  - ✅ Защита от дублей (session flag processingReceipts)
  - ✅ Фильтрация по "receipt = not issued"
  - ✅ Preview перед созданием: показывает сколько квитанций с/без receipt
  - ✅ Немедленный ответ на webhook (предотвращает timeout)
- ✅ **Создание платёжных ссылок** — название + сумма → AllPay URL
  - ✅ Фикс: убран parse_mode из сообщения с URL (спецсимволы ломали форматирование)
- ✅ **Админ Календарь** — парсинг расписания через GPT, создание событий в Google Calendar
- ✅ **Рассылка с выбором тарифов** — чекбоксы:
  - КЛУБ (все) | ПРЕМИУМ (без БАЗА) | БАЗА | ПРАКТИКА | ПРАКТИКА+ | СОПРОВОЖДЕНИЕ | ТЕСТ
  - Двухколоночная раскладка для компактности
- ✅ **Отменить квитанции** — сцена создана (scenes/admin-cancel-receipts.scene.js)
  - Загрузка Excel из Morning → отмена через GreenInvoice API
  - Прогресс показывается каждые 50 квитанций

### **Система рассылок**
- ✅ Scheduler работает (utils/scheduler.js):
  - Ежедневная проверка в 18:00 Jerusalem time
  - Instance ID в логах для отслеживания
- ✅ Поддержка тарифов: КЛУБ, ПРЕМИУМ, БАЗА, ПРАКТИКА, ПРАКТИКА+, СОПРОВОЖДЕНИЕ, ТЕСТ
- ✅ Логика тарифов:
  - КЛУБ/ВСЕ → все участники с telegram_id
  - ПРЕМИУМ → все кроме БАЗА
  - Конкретный тариф → только этот тариф
- ✅ Отправка по расписанию из Fillout MESSAGE table
- ✅ Защита от дублей:
  - Map вместо массива для хранения таймеров
  - Очистка scheduledTimeouts перед каждой проверкой
  - После отправки: set send=false в Fillout

### **Техническая база**
- ✅ **Custom Skill создан:** `telegraf-bot-structure`
  - Правильный порядок middleware (session → stage → commands)
  - Webhook setup для Railway
  - Debugging checklist
  - Типичные ошибки и решения
- ✅ Middleware order исправлен во всех файлах
- ✅ Сцена MENU пропускает команды через `next()`
- ✅ Все сцены корректно зарегистрированы (16 сцен):
  - START, PHONE, EMAIL, TARIFF, PERIOD, CONFIRM, PAYMENT
  - AI_HELP, DOCUMENTS, ACCESS, SUBSCRIBE
  - ADMIN_RECEIPTS, ADMIN_CALENDAR, ADMIN_MENU, ADMIN_PAYMENT_LINK, ADMIN_CANCEL_RECEIPTS
  - MENU

### **Решённые критические баги**
- ✅ **Webhook timeout** при обработке больших файлов:
  - Telegram повторял запрос 3 раза → 185 квитанций × 3 = 555 дублей
  - Решение: немедленный ответ на webhook + session flag
- ✅ **Дублирование квитанций** (534 вместо 29):
  - Причина: неправильный файл (245 строк вместо 29) + тройная обработка
  - Решение: preview показывает "С квитанциями" / "БЕЗ квитанций"
- ✅ **Команды не работали** для некоторых пользователей:
  - MENU scene перехватывала все текстовые сообщения
  - Решение: добавлена проверка `if (text.startsWith('/')) return next()`
- ✅ **Parse mode ломался** на специальных символах в AllPay URL (~, _)
  - Решение: убран parse_mode из сообщения с платёжной ссылкой
- ✅ **Duplicate broadcast messages**:
  - scheduledTimeouts хранились в массиве, не могли быть очищены по ID
  - Решение: Map вместо массива

---

## ⏳ **В РАБОТЕ / ТРЕБУЕТ ДОРАБОТКИ**

### **Админ-функционал**
1. ⏳ **Отменить квитанции**:
   - Функция создана (scenes/admin-cancel-receipts.scene.js)
   - Кнопка добавлена в админ-меню
   - ⚠️ Требует тестирования на реальных данных перед использованием

2. ⏳ **Админ Календарь**:
   - Базовая функция реализована
   - ⚠️ Требует тестирования GPT парсинга расписания
   - ⚠️ Проверка создания событий в Google Calendar
   - ⚠️ Рассылка с Add to Calendar links

3. ⏳ **Рассылка с чекбоксами тарифов**:
   - UI готов (scenes/broadcast-select.scene.js)
   - ⚠️ Требует подключения к admin-payment-link и admin-calendar
   - ⚠️ Тестирование выбора нескольких тарифов

### **Требует тестирования**
- ⚠️ **AI-помощник (Миша)** — может не работать из-за OpenAI quota
- ⚠️ **AllPay webhook URL** — нужно обновить на новый домен:
  - Старый: не указан
  - Новый: https://gmd-bot-production-9d5b.up.railway.app/payment/webhook
- ⚠️ **AllPay test mode** — отключить перед production

---

## 🐛 **ИЗВЕСТНЫЕ ПРОБЛЕМЫ**

1. **Евгения (ID 398770662)** писала "Admin_menu" без слэша
   - ❗ Нужна инструкция для админов или автоответ с подсказкой
   - Решение: добавить bot.hears(/admin.?menu/i) с подсказкой "/admin_menu"

---

## 📝 **TODO (приоритеты)**

### **Высокий приоритет**
1. 🔴 Протестировать отмену квитанций на реальных данных
2. 🔴 Обновить AllPay webhook URL на новый домен
3. 🔴 Проверить какие кнопки меню отключены и почему
4. 🔴 Добавить инструкцию/автоответ для команды /admin_menu

### **Средний приоритет**
5. 🟡 Подключить чекбоксы тарифов к admin-payment-link
6. 🟡 Протестировать Админ Календарь (GPT + Google Calendar + рассылка)
7. 🟡 Отключить AllPay test mode перед запуском

### **Низкий приоритет**
8. 🟢 Протестировать AI-помощника Мишу (проверить OpenAI credits)
9. 🟢 Создать полную инструкцию для админов
10. 🟢 Документация API интеграций

---

## 🎯 **Следующие шаги**

**Немедленно:**
1. Протестировать исправленную админ-кабалу (защита от дублей)
2. Уточнить какие кнопки меню закрыты

**В ближайшее время:**
1. Запустить отмену 534 ошибочных квитанций (после тестирования)
2. Протестировать админ-календарь с реальным расписанием
3. Добавить подсказку для команды /admin_menu

**Перед production launch:**
1. Обновить AllPay webhook URL
2. Отключить AllPay test mode
3. Финальная проверка всех функций

---

## 📚 **Техническая документация**

### **Environment Variables (Railway)**
```
BOT_TOKEN=...
OPENAI_API_KEY=...
ALLPAY_LOGIN=pp1016941
ALLPAY_KEY=...
GREENINVOICE_ID=...
GREENINVOICE_SECRET=...
FILLOUT_API_KEY=...
FILLOUT_DATABASE_ID=15ae45dd333b9304
FILLOUT_TABLE_ID=tazbFXH4Ub6 (TARIFF)
FILLOUT_MESSAGE_TABLE_ID=t5tVm2Fai29 (MESSAGE)
ADMIN_USER_ID=867023416
WEBHOOK_DOMAIN=https://gmd-bot-production-9d5b.up.railway.app
GOOGLE_CALENDAR_CREDENTIALS={...json...}
GOOGLE_CALENDAR_ID=xxxxx@group.calendar.google.com
ADD_URL=...
UPDATE_URL=...
LIST_URL=...
```

### **Fillout Table Structures**

**CLUB table (tkDXcWAVooU):**
- Имя фамилия, Телефон, Электронная почта (с пробелом!), Добавился в чат
- Ник в ТГ, Анкета, Доки на финплан, Финплан, Оплата, Подписка
- Тариф (Single Select), Льготы, telegram_id (Number), Админ (checkbox)

**TARIFF table (tazbFXH4Ub6):**
- БАЗА: 89₪/мес, 718₪/год
- ПРАКТИКА: 159₪/мес, 1438₪/год
- ПРАКТИКА+: 439₪/мес, 4558₪/год
- СОПРОВОЖДЕНИЕ: 649₪/мес, 6838₪/год
- Доступы: УЖИН (200₪), ДОСТУП (49₪)

**MESSAGE table (t5tVm2Fai29):**
- Тариф (Single Select: БАЗА/ПРАКТИКА/ПРАКТИКА+/СОПРОВОЖДЕНИЕ/ТЕСТ/КЛУБ/ВСЕ/ПРЕМИУМ)
- Время рассылки (DateTime ISO), Текст сообщения, send (checkbox)

### **Bitrix24 Fields**
- UF_CRM_1674059477: Номер заказа на сайте
- UF_CRM_1730301346: Уже оплатил (boolean)
- UF_CRM_1734183234: Ссылка на платеж/квитанцию
- STATUS_ID: 'CONVERTED' on payment

### **Diagnostic Commands** (можно удалить перед production)
- /ping → PONG
- /test_calendar → tests Google Calendar API
- /reset_webhook → resets Telegram webhook
- /force_reset_webhook → full webhook reset with secret token
- /check_admin → checks if user is admin
- /debug_admin → shows full member data from Fillout
- /test_admin → basic test command
- GET /health → HTTP endpoint, returns JSON status

---

## 🔧 **Важные технические заметки**

### **Middleware Order (КРИТИЧНО!)**
```javascript
// 1. Импорты
import { Telegraf, Scenes, session } from 'telegraf'

// 2. Создать бота
const bot = new Telegraf(process.env.BOT_TOKEN)

// 3. Импортировать ВСЕ сцены
import startScene from './scenes/start.scene.js'
// ... все остальные

// 4. Создать stage
const stage = new Scenes.Stage([startScene, ...])

// 5. Команды БЕЗ сцен (до middleware)
bot.command('ping', ...)

// 6. SESSION (ОБЯЗАТЕЛЬНО ПЕРВЫМ)
bot.use(session())

// 7. STAGE (ОБЯЗАТЕЛЬНО ВТОРЫМ)
bot.use(stage.middleware())

// 8. Команды СО сценами (после middleware)
bot.start((ctx) => ctx.scene.enter('START'))
bot.command('menu', (ctx) => ctx.scene.enter('MENU'))

// 9. Webhook
app.use(bot.webhookCallback('/webhook'))
app.listen(PORT)
```

### **Защита от дублей в сценах с долгой обработкой**
```javascript
scene.on('document', async (ctx) => {
  if (ctx.session.processingReceipts) {
    return ctx.reply('⏳ Уже обрабатывается...')
  }
  
  ctx.session.processingReceipts = true
  await ctx.reply('✅ Получено!')
  
  try {
    // ... долгая обработка ...
  } finally {
    ctx.session.processingReceipts = false
  }
})
```

### **Google Calendar API**
- ⚠️ Env checks должны быть ВНУТРИ функций, не на уровне модуля
- Иначе падает при импорте если переменные не установлены

---

## 📞 **Контакты и доступы**

**Админы:**
- Yuri Gold (ID: 867023416) — основной разработчик
- Diana Devora (ID: 335680136) — администратор
- Евгения (ID: 398770662) — администратор

**Сервисы:**
- Railway: courageous-learning (production)
- AllPay: pp1016941
- GreenInvoice: ID и Secret в env
- Fillout Database: 15ae45dd333b9304

---

**Статус:** 🟢 Production Ready (с учётом TODO списка)  
**Следующий milestone:** Отмена 534 ошибочных квитанций + финальное тестирование
