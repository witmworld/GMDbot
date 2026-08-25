// db/supabase.js
// Клиент Supabase для модуля активности и подписок Telegram-клуба.
// Работает со схемой tg_club через service role key (обходит RLS).
//
// Требуемые переменные окружения:
//   SUPABASE_URL          — https://zruamwfgnebvayyygelt.supabase.co
//   SUPABASE_SERVICE_KEY  — service_role ключ проекта (НЕ anon!)
//
// Если переменные не заданы — модуль работает в "no-op" режиме:
// функции не падают, просто ничего не пишут (бот продолжает работать).

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

let supabase = null
export const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY)

if (SUPABASE_ENABLED) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'tg_club' },
  })
  console.log('[Supabase] Подключён к схеме tg_club')
} else {
  console.warn('[Supabase] SUPABASE_URL / SUPABASE_SERVICE_KEY не заданы — модуль активности отключён (no-op)')
}

export { supabase }
