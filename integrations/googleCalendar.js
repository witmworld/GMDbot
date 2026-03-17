import { google } from 'googleapis'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const serviceAccount = require('../gmd-bot-calendar-d9d1c4b4a6d0.json')

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary'

function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })
  return google.calendar({ version: 'v3', auth })
}

export async function createTestEvent() {
  const calendar = getCalendarClient()
  const now      = new Date()
  const end      = new Date(now.getTime() + 60 * 60 * 1000) // +1 hour

  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary:     'Test Event from GMD Bot',
      description: 'Автоматический тестовый ивент',
      start: { dateTime: now.toISOString() },
      end:   { dateTime: end.toISOString() },
    },
  })

  return { eventId: res.data.id, htmlLink: res.data.htmlLink }
}
