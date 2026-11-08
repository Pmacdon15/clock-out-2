/**
 * The one Google scope Clock Out asks for to put shifts on a user's calendar:
 * create and update events, nothing else. Kept apart from google-calendar.ts
 * so client components can import it.
 */
export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";
