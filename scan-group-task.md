# Задание для Claude Code: Сканирование админов группы GMD Club (DRY RUN)

## Контекст
Бот GMD Club Bot имеет команду `/scan_group`, которая сканирует админов в Telegram группе.
Нужно доработать её для ПРОБНОГО запуска (без записи в базу) с проверкой существующих участников в Fillout.

## Задача
1. Создать скрипт который можно запустить напрямую из терминала
2. Сканировать админов группы через Telegram API
3. Для каждого админа проверить совпадения в Fillout CLUB table по:
   - Имя, фамилия (полное или частичное совпадение)
   - Электронная почта (полное совпадение)
   - Ник в ТГ (полное совпадение)
4. Вывести отчёт: кто найден, кто не найден
5. **НЕ ЗАПИСЫВАТЬ** в базу данных (dry run mode)

## Шаги

### 1. Создать standalone скрипт
Создай файл `scripts/scan-admins-dryrun.js`:

```javascript
import { Telegraf } from 'telegraf'
import { getClubMembers } from '../integrations/fillout.js'

const BOT_TOKEN = process.env.BOT_TOKEN
const GROUP_ID = -1003528829419

async function scanAdmins() {
  console.log('🔍 Scanning group admins (DRY RUN - no database writes)')
  console.log('Group ID:', GROUP_ID)
  console.log('')
  
  const bot = new Telegraf(BOT_TOKEN)
  
  try {
    // 1. Получить админов из Telegram
    console.log('[1/3] Getting admins from Telegram...')
    const admins = await bot.telegram.getChatAdministrators(GROUP_ID)
    const humanAdmins = admins.filter(a => !a.user.is_bot)
    
    console.log(`Found ${humanAdmins.length} human admins (${admins.length} total, ${admins.length - humanAdmins.length} bots)`)
    console.log('')
    
    // 2. Получить всех участников из Fillout
    console.log('[2/3] Getting members from Fillout CLUB table...')
    const clubMembers = await getClubMembers()
    console.log(`Found ${clubMembers.length} members in Fillout`)
    console.log('')
    
    // 3. Проверить каждого админа
    console.log('[3/3] Matching admins with Fillout members...')
    console.log('═'.repeat(80))
    console.log('')
    
    const found = []
    const notFound = []
    
    for (const admin of humanAdmins) {
      const user = admin.user
      const telegramName = `${user.first_name || ''} ${user.last_name || ''}`.trim()
      const telegramUsername = user.username ? `@${user.username}` : null
      const telegramId = user.id
      
      console.log(`👤 Checking: ${telegramName} (${telegramUsername || 'no username'}) [ID: ${telegramId}]`)
      
      // Поиск совпадений
      const matches = findMatches(user, clubMembers)
      
      if (matches.length > 0) {
        found.push({ user, matches })
        console.log(`   ✅ FOUND ${matches.length} match(es):`)
        matches.forEach(m => {
          console.log(`      - ${m.member['Имя, фамилия']} | ${m.member['Электронная почта ']} | ${m.member['Ник в ТГ']}`)
          console.log(`        Matched by: ${m.matchType}`)
        })
      } else {
        notFound.push(user)
        console.log(`   ❌ NOT FOUND in Fillout`)
      }
      console.log('')
    }
    
    // 4. Итоговый отчёт
    console.log('═'.repeat(80))
    console.log('📊 SUMMARY')
    console.log('═'.repeat(80))
    console.log(`Total admins scanned: ${humanAdmins.length}`)
    console.log(`Found in Fillout: ${found.length}`)
    console.log(`NOT found in Fillout: ${notFound.length}`)
    console.log('')
    
    if (notFound.length > 0) {
      console.log('❌ NOT FOUND:')
      notFound.forEach(user => {
        const name = `${user.first_name || ''} ${user.last_name || ''}`.trim()
        const username = user.username ? `@${user.username}` : 'no username'
        console.log(`   - ${name} (${username}) [ID: ${user.id}]`)
      })
      console.log('')
    }
    
    console.log('✅ DRY RUN COMPLETE - No changes made to database')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
  
  process.exit(0)
}

// Функция поиска совпадений
function findMatches(telegramUser, clubMembers) {
  const matches = []
  
  const telegramName = `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim().toLowerCase()
  const telegramUsername = telegramUser.username ? telegramUser.username.toLowerCase() : null
  const telegramId = telegramUser.id
  
  for (const member of clubMembers) {
    const filloutName = (member.fields['Имя, фамилия'] || '').toLowerCase()
    const filloutEmail = (member.fields['Электронная почта '] || '').toLowerCase()
    const filloutNick = (member.fields['Ник в ТГ'] || '').toLowerCase()
    const filloutTelegramId = member.fields['telegram_id']
    
    let matchType = null
    
    // 1. Точное совпадение по telegram_id (приоритет)
    if (filloutTelegramId && filloutTelegramId === telegramId) {
      matchType = 'telegram_id (exact)'
    }
    // 2. Точное совпадение по нику
    else if (telegramUsername && filloutNick.includes(telegramUsername)) {
      matchType = 'username (exact)'
    }
    // 3. Полное совпадение по имени
    else if (telegramName && filloutName === telegramName) {
      matchType = 'name (exact)'
    }
    // 4. Частичное совпадение по имени (имя содержится в fillout или наоборот)
    else if (telegramName && filloutName && 
             (filloutName.includes(telegramName) || telegramName.includes(filloutName))) {
      matchType = 'name (partial)'
    }
    // 5. Совпадение по части имени (first name or last name)
    else if (telegramUser.first_name && filloutName.includes(telegramUser.first_name.toLowerCase())) {
      matchType = 'first name (partial)'
    }
    
    if (matchType) {
      matches.push({ member, matchType })
    }
  }
  
  return matches
}

// Запуск
scanAdmins()
```

### 2. Обновить package.json
Добавь script для удобного запуска:

### 2. Обновить package.json
Добавь script для удобного запуска:

```json
{
  "scripts": {
    "scan-admins": "node scripts/scan-admins-dryrun.js"
  }
}
```

### 3. Проверить integrations/fillout.js
Убедись что функция `getClubMembers()` существует и возвращает всех участников из CLUB table.

Если функции нет — создай её:

```javascript
export async function getClubMembers() {
  const response = await fetch(
    `https://api.fillout.com/v1/api/databases/${FILLOUT_DATABASE_ID}/tables/tkDXcWAVooU/records`,
    {
      headers: {
        'Authorization': `Bearer ${FILLOUT_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  )
  
  if (!response.ok) {
    throw new Error(`Fillout API error: ${response.status}`)
  }
  
  const data = await response.json()
  return data.items || []
}
```

### 4. Запуск скрипта

**Из терминала:**
```bash
cd ~/gmd-bot
npm run scan-admins
```

**Или напрямую:**
```bash
cd ~/gmd-bot
node scripts/scan-admins-dryrun.js
```

### 5. Ожидаемый результат

Скрипт выведет:
```
🔍 Scanning group admins (DRY RUN - no database writes)
Group ID: -1003528829419

[1/3] Getting admins from Telegram...
Found 48 human admins (50 total, 2 bots)

[2/3] Getting members from Fillout CLUB table...
Found 120 members in Fillout

[3/3] Matching admins with Fillout members...
════════════════════════════════════════════════════════════════════════════════

👤 Checking: Yuri Gold (@yuridnl) [ID: 867023416]
   ✅ FOUND 1 match(es):
      - Yuri Gold | yuridnl68@gmail.com | @yuridnl
        Matched by: telegram_id (exact)

👤 Checking: Diana Devora (@dn_glv) [ID: 335680136]
   ✅ FOUND 1 match(es):
      - Diana Broitman | diana.broitman@gmail.com | 
        Matched by: first name (partial)

👤 Checking: Евгения (@Evgeniya_Reizin) [ID: 398770662]
   ✅ FOUND 1 match(es):
      - Евгения Рейзин | eugen5068@gmail.com | @Evgeniya_Reizin
        Matched by: username (exact)

👤 Checking: Alexander (@shurivich) [ID: 931994330]
   ❌ NOT FOUND in Fillout

════════════════════════════════════════════════════════════════════════════════
📊 SUMMARY
════════════════════════════════════════════════════════════════════════════════
Total admins scanned: 48
Found in Fillout: 45
NOT found in Fillout: 3

❌ NOT FOUND:
   - Alexander Ivanov (@ivanov_alex) [ID: 123456789]
   - Maria Petrova (no username) [ID: 987654321]
   - Sergey (no username) [ID: 555666777]

✅ DRY RUN COMPLETE - No changes made to database
```

### 6. Анализ результатов

После запуска проверь:
1. **Сколько админов найдено** — должно быть ~48-50
2. **Сколько совпало с Fillout** — ожидаем 80-90%
3. **Кто не найден** — это новые админы или ошибки в данных?
4. **Типы совпадений:**
   - `telegram_id (exact)` — самый надёжный
   - `username (exact)` — надёжный
   - `name (exact)` — надёжный
   - `name (partial)` — требует проверки
   - `first name (partial)` — может быть ложное срабатывание

### 7. Следующие шаги (после проверки)

**Если результаты хорошие:**
- Создадим версию скрипта которая ЗАПИСЫВАЕТ в Fillout
- Добавим обновление поля "Админ": true
- Добавим заполнение telegram_id если его нет

**Если есть проблемы:**
- Уточним алгоритм поиска
- Добавим больше способов сопоставления
- Исключим ложные срабатывания

## Проверка кода перед запуском

Claude Code должен:
1. ✅ Создать файл `scripts/scan-admins-dryrun.js`
2. ✅ Проверить наличие `getClubMembers()` в `integrations/fillout.js`
3. ✅ Добавить npm script в `package.json`
4. ✅ Показать git diff перед commit
5. ✅ НЕ ДЕЛАТЬ commit/push пока не проверим результаты

## Важные замечания

⚠️ **Это DRY RUN** — скрипт НЕ меняет базу данных, только показывает результаты

⚠️ **GROUP_ID** должен быть правильным: `-1003528829419`

⚠️ **Fillout поле email** содержит ПРОБЕЛ в конце: `'Электронная почта '`

⚠️ **Алгоритм сопоставления** может давать ложные срабатывания при частичном совпадении имён

⚠️ **Боты исключаются** автоматически (is_bot: true)

## Если возникают ошибки

**Error: Cannot find module 'telegraf'**
```bash
npm install
```

**Error: Unauthorized (Fillout API)**
```bash
# Проверь env переменные
echo $FILLOUT_API_KEY
```

**Error: Bot token invalid**
```bash
# Проверь BOT_TOKEN
echo $BOT_TOKEN
```

**Error: GROUP_ID not found**
- Проверь что бот добавлен в группу
- Проверь что GROUP_ID начинается с `-100`
- Проверь что бот имеет права админа в группе
