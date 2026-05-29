// utils/activityTracker.js
// Middleware Telegraf: фиксирует активность участников в группе(ах) клуба.
//
// ВАЖНО про Telegram Bot API:
//  - чтобы бот видел обычные (не командные) сообщения группы, у него должен
//    быть ВЫКЛЮЧЕН privacy mode (BotFather → /setprivacy → Disable) и/или
//    бот должен быть администратором группы;
//  - получение реакций требует, чтобы в setWebhook/getUpdates были разрешены
//    типы апдейтов 'message_reaction' (allowed_updates);
//  - join/leave приходят как message.new_chat_members / left_chat_member
//    или как chat_member апдейты (если включены).
//
// Трекаем только разрешённые чаты (TG_TRACKED_CHAT_IDS), личку игнорируем.

import { upsertTgUser, logEvent } from '../db/activityRepo.js'

// Список chat_id групп клуба для трекинга (через запятую в env).
// По умолчанию — известная группа клуба ГМД.
const TRACKED_CHAT_IDS = (process.env.TG_TRACKED_CHAT_IDS || '-1003528829419')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number)

function isTracked(chatId) {
  return TRACKED_CHAT_IDS.includes(Number(chatId))
}

// Тип медиа для metadata.
function detectMedia(msg) {
  if (msg.photo) return 'photo'
  if (msg.video) return 'video'
  if (msg.document) return 'document'
  if (msg.animation) return 'animation'
  if (msg.voice) return 'voice'
  if (msg.video_note) return 'video_note'
  if (msg.audio) return 'audio'
  if (msg.sticker) return 'sticker'
  return null
}

// Регистрирует трекинг на экземпляре бота.
export function registerActivityTracker(bot) {
  // ── Сообщения (текст, медиа, ответы, темы форума) ──────────────────
  bot.on('message', async (ctx, next) => {
    try {
      const msg = ctx.message
      const chat = ctx.chat
      if (chat && isTracked(chat.id) && ctx.from && !ctx.from.is_bot) {
        await upsertTgUser(ctx.from, { isInGroup: true })

        // join / leave — служебные сообщения
        if (msg.new_chat_members?.length) {
          for (const m of msg.new_chat_members) {
            if (m.is_bot) continue
            await upsertTgUser(m, { isInGroup: true })
            await logEvent({ telegram_user_id: m.id, chat_id: chat.id, event_type: 'user_joined' })
          }
        } else if (msg.left_chat_member && !msg.left_chat_member.is_bot) {
          await upsertTgUser(msg.left_chat_member, { isInGroup: false })
          await logEvent({ telegram_user_id: msg.left_chat_member.id, chat_id: chat.id, event_type: 'user_left' })
        } else {
          const text = msg.text || msg.caption || ''
          const media = detectMedia(msg)
          const isReply = !!msg.reply_to_message
          // тема форума: message_thread_id присутствует и это не обычный reply на корень
          const isTopic = !!msg.message_thread_id && !msg.reply_to_message?.forum_topic_created

          let eventType = 'message_sent'
          if (media) eventType = 'media_sent'
          else if (isTopic) eventType = 'topic_message_sent'
          else if (isReply) eventType = 'reply_sent'

          await logEvent({
            telegram_user_id: ctx.from.id,
            chat_id: chat.id,
            event_type: eventType,
            message_id: msg.message_id,
            is_reply: isReply,
            reply_to_user_id: msg.reply_to_message?.from?.id ?? null,
            text_length: text.length,
            is_command: false,
            metadata: media ? { media } : (msg.message_thread_id ? { thread_id: msg.message_thread_id } : null),
            sent_at: msg.date ? new Date(msg.date * 1000).toISOString() : undefined,
          })
        }
      }
    } catch (e) {
      console.error('[activityTracker] message error:', e.message)
    }
    return next()
  })

  // ── Реакции на сообщения (Bot API 7.0+) ────────────────────────────
  bot.on('message_reaction', async (ctx, next) => {
    try {
      const mr = ctx.update.message_reaction
      const chat = mr?.chat
      const user = mr?.user
      // считаем только добавление новой реакции (а не снятие)
      const added = (mr?.new_reaction?.length || 0) > (mr?.old_reaction?.length || 0)
      if (chat && isTracked(chat.id) && user && !user.is_bot && added) {
        await upsertTgUser(user, { isInGroup: true })
        await logEvent({
          telegram_user_id: user.id,
          chat_id: chat.id,
          event_type: 'reaction',
          message_id: mr.message_id,
          metadata: { reaction: mr.new_reaction?.[0] || null },
        })
      }
    } catch (e) {
      console.error('[activityTracker] reaction error:', e.message)
    }
    if (next) return next()
  })

  // ── Команды бота (в группе) ────────────────────────────────────────
  // Личные команды НЕ считаем как активность группы; только в трекаемых чатах.
  bot.use(async (ctx, next) => {
    try {
      const msg = ctx.message
      const chat = ctx.chat
      if (
        chat && isTracked(chat.id) && ctx.from && !ctx.from.is_bot &&
        msg?.text && msg.text.startsWith('/')
      ) {
        const cmd = msg.text.split(/[\s@]/)[0]
        await logEvent({
          telegram_user_id: ctx.from.id,
          chat_id: chat.id,
          event_type: 'bot_command_used',
          message_id: msg.message_id,
          is_command: true,
          metadata: { command: cmd },
          sent_at: msg.date ? new Date(msg.date * 1000).toISOString() : undefined,
        })
      }
    } catch (e) {
      console.error('[activityTracker] command error:', e.message)
    }
    return next()
  })

  console.log('[activityTracker] Трекинг активности зарегистрирован. Чаты:', TRACKED_CHAT_IDS.join(', '))
}
