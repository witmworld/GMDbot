-- =====================================================================
-- tg_club — модуль активности и отслеживания подписок Telegram-клуба
-- Проект Supabase: "Where is the money" (zruamwfgnebvayyygelt)
-- Изолированная схема, чтобы не смешиваться с данными приложения (public).
-- Идемпотентно: можно применять повторно.
-- Все временные метки в UTC (timestamptz).
-- =====================================================================

create schema if not exists tg_club;

-- ---------------------------------------------------------------------
-- 1. Участники Telegram-группы
-- ---------------------------------------------------------------------
create table if not exists tg_club.tg_users (
    id                bigserial primary key,
    telegram_user_id  bigint      not null unique,
    username          text,
    first_name        text,
    last_name         text,
    language_code     text,
    is_bot            boolean     not null default false,
    -- связь с профилем приложения (если удастся сопоставить); не обязательна
    app_profile_id    uuid,
    is_in_group       boolean     not null default true,
    joined_at         timestamptz,
    left_at           timestamptz,
    last_seen_at      timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index if not exists idx_tg_users_uid on tg_club.tg_users (telegram_user_id);

-- ---------------------------------------------------------------------
-- 2. Сырые события активности (append-only лог)
--    Bot API видит сообщения только при выключенном privacy mode и
--    правах админа у бота. Считаем активность по входящим апдейтам.
-- ---------------------------------------------------------------------
create table if not exists tg_club.tg_activity_events (
    id                 bigserial primary key,
    telegram_user_id   bigint      not null,
    chat_id            bigint,
    event_type         text        not null,   -- message_sent | reply_sent | topic_message_sent
                                                -- reaction | media_sent | user_joined | user_left
                                                -- bot_command_used
    message_id         bigint,
    is_reply           boolean     not null default false,
    reply_to_user_id   bigint,
    text_length        integer,
    is_command         boolean     not null default false,
    metadata           jsonb,                  -- доп. данные (имя команды, тип медиа и т.п.)
    sent_at            timestamptz not null default now(),
    created_at         timestamptz not null default now()
);

create index if not exists idx_tg_events_user_time on tg_club.tg_activity_events (telegram_user_id, sent_at);
create index if not exists idx_tg_events_type       on tg_club.tg_activity_events (event_type);
create index if not exists idx_tg_events_sent_at    on tg_club.tg_activity_events (sent_at);

-- ---------------------------------------------------------------------
-- 3. Дневные агрегаты по пользователю (строит фоновая задача)
-- ---------------------------------------------------------------------
create table if not exists tg_club.tg_activity_daily (
    id                 bigserial primary key,
    telegram_user_id   bigint      not null,
    activity_date      date        not null,
    messages           integer     not null default 0,
    replies            integer     not null default 0,
    topic_messages     integer     not null default 0,
    reactions          integer     not null default 0,
    media              integer     not null default 0,
    commands           integer     not null default 0,
    events_total       integer     not null default 0,   -- всего событий за день
    created_at         timestamptz not null default now(),
    unique (telegram_user_id, activity_date)
);

create index if not exists idx_tg_daily_user on tg_club.tg_activity_daily (telegram_user_id, activity_date);
create index if not exists idx_tg_daily_date on tg_club.tg_activity_daily (activity_date);

-- ---------------------------------------------------------------------
-- 4. Сводка активности по пользователю (окна 7/30/90/365)
--    Ранги/сегменты пока не считаем — поле segment зарезервировано.
-- ---------------------------------------------------------------------
create table if not exists tg_club.tg_user_activity (
    telegram_user_id   bigint      primary key,
    events_7d          integer     not null default 0,
    events_30d         integer     not null default 0,
    events_90d         integer     not null default 0,
    events_365d        integer     not null default 0,
    messages_30d       integer     not null default 0,
    last_event_at      timestamptz,
    -- зарезервировано на будущее (ранги/сегменты настроим позже)
    segment            text,
    rank_code          text,
    computed_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. Подписки — ТОЛЬКО отслеживание статуса/сроков (без оплаты).
--    Платёжная логика остаётся в старом потоке (AllPay/Fillout/Bitrix).
--    Поля заполняются вручную/импортом/будущей синхронизацией.
-- ---------------------------------------------------------------------
do $$ begin
    create type tg_club.subscription_status as enum
        ('active', 'expiring_soon', 'grace', 'expired', 'removed', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists tg_club.tg_subscriptions (
    id                     bigserial primary key,
    telegram_user_id       bigint      not null,
    plan_code              text,                       -- base | practice | practice_plus | support
    status                 tg_club.subscription_status not null default 'active',
    starts_at              timestamptz,
    ends_at                timestamptz,
    grace_until            timestamptz,
    auto_renew             boolean     not null default false,
    -- метки отправленных напоминаний (7/3/1 дня), чтобы не слать повторно
    reminded_7d_at         timestamptz,
    reminded_3d_at         timestamptz,
    reminded_1d_at         timestamptz,
    removed_from_group_at  timestamptz,
    source                 text,                       -- 'fillout' | 'manual' | 'import' | ...
    note                   text,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);

create index if not exists idx_tg_subs_user   on tg_club.tg_subscriptions (telegram_user_id);
create index if not exists idx_tg_subs_status on tg_club.tg_subscriptions (status);
create index if not exists idx_tg_subs_ends   on tg_club.tg_subscriptions (ends_at);

-- ---------------------------------------------------------------------
-- 6. Журнал событий подписок (для аудита)
-- ---------------------------------------------------------------------
create table if not exists tg_club.tg_subscription_events (
    id                 bigserial primary key,
    subscription_id    bigint      references tg_club.tg_subscriptions(id) on delete cascade,
    telegram_user_id   bigint      not null,
    event              text        not null,   -- created | reminder_sent | grace_started | expired | removed | renewed
    detail             jsonb,
    created_at         timestamptz not null default now()
);

create index if not exists idx_tg_sub_events_user on tg_club.tg_subscription_events (telegram_user_id, created_at);

-- ---------------------------------------------------------------------
-- updated_at триггер
-- ---------------------------------------------------------------------
create or replace function tg_club.touch_updated_at() returns trigger as $$
begin
    new.updated_at = now();
    return new;
end; $$ language plpgsql;

do $$ begin
    create trigger trg_tg_users_touch before update on tg_club.tg_users
        for each row execute function tg_club.touch_updated_at();
    create trigger trg_tg_subs_touch  before update on tg_club.tg_subscriptions
        for each row execute function tg_club.touch_updated_at();
exception when duplicate_object then null; end $$;
