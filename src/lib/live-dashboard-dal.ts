import { auth, clerkClient } from "@clerk/nextjs/server";
import { connection } from "next/server";
import { fetchAllPages } from "./clerk-pagination";
import { dbGetBreakSettings, dbGetLiveOrgEntries, dbGetPayRates } from "./db";
import {
  LIVE_LOOKBACK_HOURS,
  type LiveDashboardData,
  type LiveMember,
} from "./live-dashboard";
import { payRateMap } from "./pay";
import type { SerializableResult, TimeEntry } from "./types";
import { getProcessedMembers } from "./utils-clerk";

type Result = SerializableResult<LiveDashboardData, { reason: string }>;

async function membersOf(orgId: string): Promise<LiveMember[]> {
  const client = await clerkClient();
  const members = await fetchAllPages(
    (params) =>
      client.organizations.getOrganizationMembershipList({
        organizationId: orgId,
        ...params,
      }),
    { label: `members of ${orgId}` },
  );
  return (await getProcessedMembers(orgId, members)).filter((m) => m.id);
}

/**
 * Everything the admin's live dashboard needs for the active organization:
 * its members, every open shift plus the last two days of closed ones, the
 * break rules and each member's hourly rate. Admins only.
 */
export async function getLiveDashboard(): Promise<Result> {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId || orgRole !== "org:admin") {
    return {
      ok: false,
      error: { reason: "Only organization admins can see the live dashboard." },
    };
  }

  // Reads the clock, so it can't be part of a prerender.
  await connection();
  const since = new Date(Date.now() - LIVE_LOOKBACK_HOURS * 3_600_000);

  try {
    const [members, entries, breakSettings, rates] = await Promise.all([
      membersOf(orgId),
      dbGetLiveOrgEntries(orgId, since),
      dbGetBreakSettings(orgId),
      dbGetPayRates(orgId),
    ]);

    const hourlyRates: Record<string, number> = {};
    for (const [id, rate] of payRateMap(rates)) {
      hourlyRates[id] = rate.hourlyRate;
    }

    return {
      ok: true,
      value: {
        members,
        breakSettings: breakSettings ?? null,
        hourlyRates,
        // Only what the page shows: no punch coordinates or addresses.
        shifts: (entries as TimeEntry[])
          .filter((e) => e.org_id === orgId)
          .map((e) => ({
            id: e.id,
            userId: e.user_id,
            clockIn: e.clock_in,
            clockOut: e.clock_out,
            skipLunch: Boolean(e.skip_lunch),
            breaks: (e.breaks ?? []).map((b) => ({
              break_type: b.break_type,
              break_start: b.break_start,
              break_end: b.break_end,
            })),
            siteName: e.clock_in_site_name ?? null,
          })),
      },
    };
  } catch (error) {
    console.error("Error loading the live dashboard:", error);
    return {
      ok: false,
      error: { reason: "Could not load the live dashboard." },
    };
  }
}
