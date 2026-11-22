import { auth } from "@clerk/nextjs/server";
import { err, ok, type Result } from "neverthrow";
import { dbClaimAlert } from "./alerts-db";
import {
  type ArrivalSite,
  arrivalAlertKey,
  arrivalPromptMessage,
  isArrivalPromptEnabled,
  isPreciseEnough,
} from "./arrival";
import { NOTIFICATIONS_FEATURE } from "./billing";
import {
  dbCheckActiveEntry,
  dbGetLocationSettings,
  dbGetSites,
  dbGetSitesForEnforcement,
} from "./db";
import { type Coordinates, findMatchingSite } from "./geo";
import { deliver } from "./notify";
import { GEOFENCING_FEATURE } from "./plan-features";
import {
  ARRIVAL_REPORT_LIMIT,
  checkRateLimit,
  rateLimitedMessage,
} from "./rate-limit";
import type { SerializableResult } from "./types";

type Failure = { reason: string };

/** What the member's device needs to watch for arrivals. */
export type ArrivalWatchConfig = {
  enabled: boolean;
  sites: ArrivalSite[];
};

const OFF: ArrivalWatchConfig = { enabled: false, sites: [] };

/**
 * Whether this member's device should watch for arrivals, and the sites to
 * watch. Off (with no sites) unless the org has the geofencing feature, has
 * switched prompts on, and has at least one site.
 */
export async function getArrivalWatchConfig(): Promise<
  SerializableResult<ArrivalWatchConfig, Failure>
> {
  const { userId, orgId, has } = await auth.protect();
  if (!userId || !orgId || !has({ feature: GEOFENCING_FEATURE })) {
    return { ok: true, value: OFF };
  }
  try {
    const settings = await dbGetLocationSettings(orgId);
    if (!isArrivalPromptEnabled(settings)) return { ok: true, value: OFF };
    const sites = await dbGetSites(orgId);
    if (sites.length === 0) return { ok: true, value: OFF };
    return {
      ok: true,
      value: {
        enabled: true,
        sites: sites.map(
          ({ id, name, latitude, longitude, radius_meters }) => ({
            id,
            name,
            latitude,
            longitude,
            radius_meters,
          }),
        ),
      },
    };
  } catch (e) {
    console.error("Error loading arrival prompt settings: ", e);
    return { ok: false, error: { reason: "Error loading arrival prompts." } };
  }
}

/**
 * - `prompted`: a prompt went out for `siteName`; `pushed` devices took it
 *   (0 when the member has no push devices, so the app should ask in-page).
 * - `skipped`: nothing to do (`why` says which rule held it back).
 */
export type ArrivalOutcome =
  | { status: "prompted"; siteName: string; pushed: number }
  | {
      status: "skipped";
      why:
        | "off"
        | "imprecise"
        | "not_at_site"
        | "clocked_in"
        | "already_prompted";
    };

/**
 * The member's device says it just entered a site. The device's word is only
 * evidence: the point is checked against the org's current sites here, and
 * the member must not already be clocked in. One prompt per site per
 * cooldown window, however many devices report it.
 */
export async function reportSiteArrivalDal(
  coordinates: Coordinates | null | undefined,
  now: Date = new Date(),
): Promise<Result<ArrivalOutcome, Failure>> {
  const { userId, orgId, has } = await auth.protect();
  if (!userId || !orgId) {
    return err({ reason: "Unauthorized or no organization selected" });
  }
  if (!has({ feature: GEOFENCING_FEATURE })) {
    return ok({ status: "skipped", why: "off" });
  }
  if (!isPreciseEnough(coordinates)) {
    return ok({ status: "skipped", why: "imprecise" });
  }

  const limit = await checkRateLimit(ARRIVAL_REPORT_LIMIT, userId);
  if (!limit.ok) {
    return err({ reason: rateLimitedMessage(limit.retryAfterSeconds) });
  }

  try {
    const settings = await dbGetLocationSettings(orgId);
    if (!isArrivalPromptEnabled(settings)) {
      return ok({ status: "skipped", why: "off" });
    }

    const site = findMatchingSite(
      coordinates,
      await dbGetSitesForEnforcement(orgId),
    );
    if (!site) return ok({ status: "skipped", why: "not_at_site" });

    const active = await dbCheckActiveEntry(userId, orgId);
    if (active.length > 0) return ok({ status: "skipped", why: "clocked_in" });

    const claimed = await dbClaimAlert(
      arrivalAlertKey({ userId, orgId, siteId: site.id, now }),
      orgId,
    );
    if (!claimed) return ok({ status: "skipped", why: "already_prompted" });

    // Push is part of the paid Notifications feature; without it the app
    // still asks in-page.
    const counts = has({ feature: NOTIFICATIONS_FEATURE })
      ? await deliver([
          {
            // Push only: an email about arriving would land long after.
            recipient: { userId, email: null },
            category: "shift_alerts",
            message: arrivalPromptMessage({ siteName: site.name, orgId }),
          },
        ])
      : { email: 0, push: 0 };

    return ok({ status: "prompted", siteName: site.name, pushed: counts.push });
  } catch (e) {
    console.error("Error handling site arrival: ", e);
    return err({ reason: "Error handling site arrival." });
  }
}
