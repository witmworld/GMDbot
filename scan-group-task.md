# Задание для Claude Code: Сканирование админов группы GMD Club

## Контекст
Бот GMD Club Bot уже имеет команду `/scan_group`, которая сканирует админов в Telegram группе и создаёт записи в Fillout CLUB table.

## Задача
Запустить команду `/scan_group` для обновления списка админов в базе данных.

## Шаги

### 1. Проверить существующую команду
```bash
cd ~/gmd-bot
grep -n "scan_group" index.js
```

Команда должна быть зарегистрирована и работать.

### 2. Проверить ID группы
В коде должен быть hardcoded GROUP_ID. Проверь что это правильная группа:
```javascript
const GROUP_ID = -1003528829419
```

### 3. Проверить как вызывается команда
Команда `/scan_group` должна:
- Работать только в приватном чате сботом (не в группе)
- Проверять что пользователь — админ (ID: 867023416)
- Получать список админов через `ctx.telegram.getChatAdministrators(GROUP_ID)`
- Создавать/обновлять записи в Fillout CLUB table

### 4. Если команда НЕ найдена или сломана
Создай её заново в `index.js` (ПОСЛЕ middleware, ПЕРЕД bot.launch):

```javascript
// Scan group admins (только для основного админа в приватном чате)
bot.command('scan_group', async (ctx) => {
  // Проверка: только приватный чат
  if (ctx.chat.type !== 'private') {
    return ctx.reply('❌ Эта команда работает только в приватном чате с ботом')
  }
  
  // Проверка: только главный админ
  if (ctx.from.id !== 867023416) {
    return ctx.reply('❌ Недостаточно прав')
  }
  
  const GROUP_ID = -1003528829419
  
  try {
    await ctx.reply('🔍 Сканирую админов группы...')
    
    const admins = await ctx.telegram.getChatAdministrators(GROUP_ID)
    
    console.log('[Scan Group] Found admins:', admins.length)
    
    let processed = 0
    let created = 0
    let errors = 0
    
    for (const admin of admins) {
      const user = admin.user
      
      if (user.is_bot) {
        console.log('[Scan Group] Skipping bot:', user.username)
        continue
      }
      
      try {
        // Создать запись в Fillout CLUB table
        const record = {
          'Имя, фамилия': `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'Unknown',
          'Ник в ТГ': user.username ? `@${user.username}` : '',
          'telegram_id': user.id,
          'Добавился в чат': 'да',
          'Админ': true
        }
        
        // Здесь должен быть вызов Fillout API для создания записи
        // Используй функцию из integrations/fillout.js если есть
        // Или создай через fetch напрямую
        
        console.log('[Scan Group] Processed:', record['Имя, фамилия'])
        processed++
        created++
        
      } catch (err) {
        console.error('[Scan Group] Error processing admin:', user.id, err.message)
        errors++
      }
    }
    
    await ctx.reply(
      `✅ Сканирование завершено!\n\n` +
      `Найдено админов: ${admins.length}\n` +
      `Обработано: ${processed}\n` +
      `Создано/обновлено: ${created}\n` +
      `Ошибок: ${errors}`
    )
    
  } catch (error) {
    console.error('[Scan Group] Error:', error)
    await ctx.reply('❌ Ошибка при сканировании группы')
  }
})
```

### 5. Деплой
```bash
git add .
git commit -m 'Add/fix scan_group command'
git push
```

### 6. Тестирование
После деплоя:
1. Открой Telegram
2. Найди бота @GMD_club_bot
3. Напиши `/scan_group`
4. Проверь что команда отработала
5. Проверь Railway logs для деталей

## Проверка результата
1. Зайди в Fillout → CLUB table
2. Проверь что появились новые записи с `Админ: true`
3. Проверь что `telegram_id` заполнены

## Важно
- Команда должна работать ТОЛЬКО в приватном чате (не в группе)
- Доступ ТОЛЬКО для ID: 867023416
- Боты должны ИГНОРИРОВАТЬСЯ (is_bot: true)
- Логи должны показывать сколько админов найдено и обработано

## Если возникают ошибки
1. Проверь что бот добавлен в группу как админ
2. Проверь GROUP_ID (должен начинаться с -100)
3. Проверь Fillout API credentials в env
4. Посмотри логи Railway для деталей ошибки
