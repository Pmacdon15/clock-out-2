/**
 * The dashboard's pages. Each one used to be a client-side tab on `/`,
 * selected with `?defaultTab=<tab>`; now each is its own server-rendered
 * route with its own static shell.
 */
export const DASHBOARD_ROUTES = {
  "time-clock": "/",
  view: "/hours",
  notifications: "/notifications",
  schedule: "/schedule",
  "time-off": "/time-off",
  settings: "/settings",
} as const;

export type DashboardTab = keyof typeof DASHBOARD_ROUTES;
export type DashboardPath = (typeof DASHBOARD_ROUTES)[DashboardTab];

/** Routes only signed-in members may open (`/` is handled separately). */
export const SIGNED_IN_ROUTES = Object.values(DASHBOARD_ROUTES).filter(
  (path) => path !== "/",
);

/**
 * Where an old `/?defaultTab=<tab>` link (emails, push notifications and
 * installed-app shortcuts sent before the tabs became pages) should land now,
 * keeping every other query param. Returns null for anything else.
 */
export function legacyTabRedirect(url: URL): URL | null {
  if (url.pathname !== "/") return null;
  const tab = url.searchParams.get("defaultTab");
  if (tab === null) return null;

  const target = new URL(url);
  target.searchParams.delete("defaultTab");
  target.pathname =
    tab in DASHBOARD_ROUTES ? DASHBOARD_ROUTES[tab as DashboardTab] : "/";
  return target;
}
