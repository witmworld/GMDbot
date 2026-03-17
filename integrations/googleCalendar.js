import { google } from 'googleapis'

if (!process.env.GOOGLE_CALENDAR_CREDENTIALS) {
  throw new Error('GOOGLE_CALENDAR_CREDENTIALS not set in environment')
}

if (!process.env.GOOGLE_CALENDAR_ID) {
  throw new Error('GOOGLE_CALENDAR_ID not set in environment')
}

const credentials = JSON.parse(process.env.GOOGLE_CALENDAR_CREDENTIALS)
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID

function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    credentials,
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

  return { id: res.data.id, htmlLink: res.data.htmlLink }
}
