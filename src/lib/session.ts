import { auth } from "@clerk/nextjs/server";
import { cache } from "react";

/**
 * The signed-in session, read once per request however many Suspense holes
 * on the page ask for it. Call it without awaiting in a page and hand the
 * promise (or something derived from it) to a child inside <Suspense>.
 */
export const getSession = cache(() => auth.protect());

/** Whether the caller is an admin of the active organization. */
export function isAdmin() {
  return getSession().then((session) => session.has({ role: "org:admin" }));
}

/** Whether the active organization's plan includes `feature`. */
export function hasFeature(feature: string) {
  return getSession().then((session) => session.has({ feature }));
}
