# Модуль активности + подписок (tg_club)

Новый модуль трекинга активности участников Telegram-клуба и отслеживания
статусов подписок. Данные хранятся в Supabase (проект «Where is the money»),
схема `tg_club`. Платёжной логики здесь нет — только аналитика активности и
отслеживание подписок. Старый поток (Fillout/AllPay) продолжает работать
параллельно и будет выведен из эксплуатации позже.

## Что добавлено

- `db/supabase.js` — клиент Supabase (схема `tg_club`, service_role key).
  Если переменные окружения не заданы — модуль работает в no-op режиме и бот
  не падает.
- `db/activityRepo.js` — репозиторий: upsertTgUser, logEvent, rebuildDaily,
  recomputeUserActivity, topActive, dormantUsers, activityTotals,
  getUsersByIds, subscriptionOverview.
- `utils/activityTracker.js` — `registerActivityTracker(bot)`: фиксирует
  сообщения / медиа / ответы / темы форума / реакции / join-leave / команды
  в трекаемых чатах.
- `utils/activityScheduler.js` — `startActivityScheduler({runOnStart})`:
  ежедневный пересчёт дневных агрегатов и окон активности (00:20,
  Asia/Jerusalem).
- `scenes/activity-report.scene.js` — сцена `ACTIVITY_REPORT`: админ-отчёты
  (топ активных за 7/30/90/365 дней, «спящие» участники, обзор подписок,
  ручной пересчёт). Кнопка «📊 Активность клуба» в админ-меню, команда
  `/activity`.
- `sql/tg_club_001_schema.sql`, `sql/tg_club_002_functions.sql` — зеркало
  применённых миграций.

## Переменные окружения (Railway)

| Переменная             | Значение / описание                                            |
| ---------------------- | -------------------------------------------------------------- |
| `SUPABASE_URL`         | `https://zruamwfgnebvayyygelt.supabase.co`                     |
| `SUPABASE_SERVICE_KEY` | service_role ключ проекта (Settings → API → service_role). **Секрет, не anon!** |
| `TG_TRACKED_CHAT_IDS`  | ID групп клуба через запятую. По умолчанию `-1003528829419`.    |

Если `SUPABASE_URL` или `SUPABASE_SERVICE_KEY` не заданы — трекинг отключается
(no-op), остальной функционал бота не затрагивается.

## Важные требования Telegram

- **Privacy mode**: чтобы бот видел обычные (не командные) сообщения группы,
  у бота должен быть ВЫКЛЮЧЕН privacy mode (BotFather → `/setprivacy` →
  Disable) и/или бот должен быть администратором группы.
- **Реакции**: `setWebhook` теперь передаёт `allowed_updates` с включённым
  `message_reaction` — иначе Telegram не присылает реакции.

## Окна активности

Активность пользователя агрегируется по окнам **7 / 30 / 90 / 365 дней**
(колонки `events_7d`, `events_30d`, `events_90d`, `events_365d` в
`tg_club.tg_user_activity`). Рангов пока нет — только анализ активности.

## Безопасность (RLS)

RLS на 6 таблицах схемы `tg_club` сейчас **выключен** (Supabase advisory).
Доступ к данным идёт только через service_role key из бэкенда бота, поэтому
для текущей схемы это безопасно. При желании можно включить RLS — SQL см.
ниже (применять вручную, по желанию):

```sql
ALTER TABLE tg_club.tg_users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_club.tg_activity_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_club.tg_activity_daily       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_club.tg_user_activity        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_club.tg_subscriptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_club.tg_subscription_events  ENABLE ROW LEVEL SECURITY;
```

service_role key обходит RLS, поэтому бот продолжит работать. Для anon/публичного
доступа потребуются отдельные политики (сейчас не нужны).
