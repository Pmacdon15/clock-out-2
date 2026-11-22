import type { NotificationMessage } from "./alerts";
import {
  type Coordinates,
  findMatchingSite,
  isValidCoordinates,
  type SiteLike,
} from "./geo";
import type { LocationSettingsData } from "./types";

/**
 * Geofence arrival prompts: "You've arrived at Site A. Clock in?"
 *
 * Browsers have no background geofencing, so the member's device watches its
 * position only while Clock Out is open (a tab, or the installed app while
 * the OS keeps it alive). When a fix moves from outside every site to inside
 * one, the device tells the server, which re-checks the point against the
 * org's sites, makes sure the member isn't already on the clock, and pushes
 * the prompt to their devices at most once per site per cooldown window.
 *
 * Everything in this file is pure, so both sides share the same rules.
 */

/** How long after one prompt for a site the next one for it can go out. */
export const ARRIVAL_PROMPT_COOLDOWN_MS = 3 * 60 * 60 * 1000;

/**
 * Fixes vaguer than this are ignored: a 2 km accuracy circle says nothing
 * about which site the member is at, and would prompt on a drive-by.
 */
export const MAX_ARRIVAL_ACCURACY_METERS = 250;

/** Whether the org has turned arrival prompts on. */
export const isArrivalPromptEnabled = (
  settings: Pick<LocationSettingsData, "arrival_prompts"> | null | undefined,
) => settings?.arrival_prompts === true;

/** A fix good enough to say which site the member is at. */
export function isPreciseEnough(
  coordinates: Coordinates | null | undefined,
): coordinates is Coordinates {
  if (!isValidCoordinates(coordinates)) return false;
  const accuracy = coordinates.accuracy;
  return (
    accuracy === null ||
    accuracy === undefined ||
    !Number.isFinite(accuracy) ||
    accuracy <= MAX_ARRIVAL_ACCURACY_METERS
  );
}

/**
 * Key for the sent-alert log: one prompt per member, org and site in each
 * cooldown window, however many devices or tabs report the arrival.
 */
export function arrivalAlertKey({
  userId,
  orgId,
  siteId,
  now,
}: {
  userId: string;
  orgId: string;
  siteId: number;
  now: Date;
}) {
  const window = Math.floor(now.getTime() / ARRIVAL_PROMPT_COOLDOWN_MS);
  return `arrival:${orgId}:${userId}:${siteId}:${window}`;
}

/** The push the member gets on arrival. Tapping it opens the time clock. */
export function arrivalPromptMessage({
  siteName,
  orgId,
}: {
  siteName: string;
  orgId: string;
}): NotificationMessage {
  return {
    title: "Clock in?",
    body: `You've arrived at ${siteName}. Clock in?`,
    url: `/?orgId=${encodeURIComponent(orgId)}`,
    tag: `arrival:${orgId}`,
  };
}

/** The bits of a site the device needs to spot an arrival. */
export type ArrivalSite = SiteLike & { id: number };

/**
 * Feeds one position fix through the watcher's state. `insideSiteId` is the
 * site the previous fix was in (null when outside every site, undefined
 * before the first fix). Returns the new state and, on a transition into a
 * site, that site.
 *
 * A first fix that is already inside a site counts as an arrival: opening the
 * app at the door should still ask. A vague fix changes nothing, so a brief
 * loss of signal doesn't read as leaving and coming back.
 */
export function trackArrival<T extends ArrivalSite>(
  insideSiteId: number | null | undefined,
  coordinates: Coordinates | null | undefined,
  sites: readonly T[],
): { insideSiteId: number | null | undefined; arrivedAt: T | null } {
  if (!isPreciseEnough(coordinates)) {
    return { insideSiteId, arrivedAt: null };
  }
  const site = findMatchingSite(coordinates, sites);
  const nextId = site ? site.id : null;
  return {
    insideSiteId: nextId,
    arrivedAt: site && nextId !== insideSiteId ? site : null,
  };
}
