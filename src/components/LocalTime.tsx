"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * True once React is running in the browser. During server rendering and
 * hydration it is false, so the first client render matches the server's
 * HTML; React then re-renders with true straight after hydrating.
 */
export function useIsClient() {
  return useSyncExternalStore(subscribe, onClient, onServer);
}

/**
 * Shows a date or time in the viewer's own time zone.
 *
 * The server renders in UTC (Vercel's zone), so formatting a timestamp there
 * gives the UTC wall-clock time. Paired with `suppressHydrationWarning`, React
 * kept that server text in the browser, which showed an 8:05 AM CST shift as
 * "2:05 PM". This renders nothing on the server and formats only in the
 * browser, so the text is always local.
 */
export default function LocalTime({ children }: { children: () => string }) {
  return useIsClient() ? children() : null;
}
