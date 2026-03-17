import { google } from 'googleapis'

function checkEnv() {
  if (!process.env.GOOGLE_CALENDAR_CREDENTIALS) {
    throw new Error('GOOGLE_CALENDAR_CREDENTIALS not set in environment')
  }
  if (!process.env.GOOGLE_CALENDAR_ID) {
    throw new Error('GOOGLE_CALENDAR_ID not set in environment')
  }
}

function getCalendarClient() {
  checkEnv()
  const credentials = JSON.parse(process.env.GOOGLE_CALENDAR_CREDENTIALS)
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })
  return { calendar: google.calendar({ version: 'v3', auth }), calendarId: process.env.GOOGLE_CALENDAR_ID }
}

export async function createCalendarEvent(event) {
  const { calendar, calendarId } = getCalendarClient()

  const dateRaw = (event.date || '').trim()
  const timeRaw = (event.time || '00:00').trim()

  // Normalise DD.MM.YYYY → YYYY-MM-DD
  let iso = dateRaw
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateRaw)) {
    const [d, m, y] = dateRaw.split('.')
    iso = `${y}-${m}-${d}`
  }

  const start = new Date(`${iso}T${timeRaw}:00`)
  let durationMs = 60 * 60 * 1000
  if (event.duration) {
    const h = event.duration.match(/(\d+(?:\.\d+)?)\s*(?:час|hour|ч)/i)
    const m = event.duration.match(/(\d+)\s*(?:мин|min)/i)
    if (h) durationMs = parseFloat(h[1]) * 60 * 60 * 1000
    else if (m) durationMs = parseInt(m[1]) * 60 * 1000
  }
  const end = new Date(start.getTime() + durationMs)

  const description = [
    event.description,
    event.link ? `Ссылка: ${event.link}` : '',
  ].filter(Boolean).join('\n')

  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary:     event.title,
      description,
      start: { dateTime: start.toISOString() },
      end:   { dateTime: end.toISOString() },
    },
  })

  return { id: res.data.id, htmlLink: res.data.htmlLink }
}

export async function createTestEvent() {
  const { calendar, calendarId } = getCalendarClient()
  const now = new Date()
  const end = new Date(now.getTime() + 60 * 60 * 1000) // +1 hour

  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary:     'Test Event from GMD Bot',
      description: 'Автоматический тестовый ивент',
      start: { dateTime: now.toISOString() },
      end:   { dateTime: end.toISOString() },
    },
  })

  return { id: res.data.id, htmlLink: res.data.htmlLink }
}
