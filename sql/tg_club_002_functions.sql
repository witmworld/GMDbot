-- =====================================================================
-- tg_club — функции пересчёта активности (вызываются фоновой задачей)
-- Идемпотентно.
-- =====================================================================

-- Пересчёт дневных агрегатов за указанную дату (по умолчанию вчера, UTC).
-- Перестраивает строки в tg_activity_daily из сырых событий.
create or replace function tg_club.rebuild_daily(target_date date default ((now() at time zone 'utc')::date - 1))
returns integer
language plpgsql
as $$
declare
    affected integer;
begin
    delete from tg_club.tg_activity_daily where activity_date = target_date;

    insert into tg_club.tg_activity_daily
        (telegram_user_id, activity_date, messages, replies, topic_messages,
         reactions, media, commands, events_total)
    select
        e.telegram_user_id,
        target_date,
        count(*) filter (where e.event_type = 'message_sent'),
        count(*) filter (where e.event_type = 'reply_sent'),
        count(*) filter (where e.event_type = 'topic_message_sent'),
        count(*) filter (where e.event_type = 'reaction'),
        count(*) filter (where e.event_type = 'media_sent'),
        count(*) filter (where e.event_type = 'bot_command_used'),
        count(*)
    from tg_club.tg_activity_events e
    where (e.sent_at at time zone 'utc')::date = target_date
      and e.event_type in ('message_sent','reply_sent','topic_message_sent',
                           'reaction','media_sent','bot_command_used')
    group by e.telegram_user_id;

    get diagnostics affected = row_count;
    return affected;
end;
$$;

-- Пересчёт сводки 7/30/90/365 по всем пользователям из сырых событий.
-- Считаем по «активным» типам (исключаем системные join/leave).
create or replace function tg_club.recompute_user_activity()
returns integer
language plpgsql
as $$
declare
    affected integer;
begin
    insert into tg_club.tg_user_activity
        (telegram_user_id, events_7d, events_30d, events_90d, events_365d,
         messages_30d, last_event_at, computed_at)
    select
        e.telegram_user_id,
        count(*) filter (where e.sent_at >= now() - interval '7 days'),
        count(*) filter (where e.sent_at >= now() - interval '30 days'),
        count(*) filter (where e.sent_at >= now() - interval '90 days'),
        count(*) filter (where e.sent_at >= now() - interval '365 days'),
        count(*) filter (where e.sent_at >= now() - interval '30 days'
                          and e.event_type in ('message_sent','reply_sent','topic_message_sent')),
        max(e.sent_at),
        now()
    from tg_club.tg_activity_events e
    where e.event_type in ('message_sent','reply_sent','topic_message_sent',
                           'reaction','media_sent','bot_command_used')
    group by e.telegram_user_id
    on conflict (telegram_user_id) do update set
        events_7d     = excluded.events_7d,
        events_30d    = excluded.events_30d,
        events_90d    = excluded.events_90d,
        events_365d   = excluded.events_365d,
        messages_30d  = excluded.messages_30d,
        last_event_at = excluded.last_event_at,
        computed_at   = now();

    get diagnostics affected = row_count;
    return affected;
end;
$$;
