/**
 * Subscribe links for a calendar feed URL (see calendar-feed.ts). Kept apart
 * from the token code so client components can import it.
 */

/** One-click subscribe links for the common calendar apps. */
export function calendarSubscribeLinks(feedUrl: string) {
  const webcal = feedUrl.replace(/^https?:\/\//, "webcal://");
  return {
    apple: webcal,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${encodeURIComponent("Clock Out shifts")}`,
  };
}
