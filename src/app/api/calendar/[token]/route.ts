import { clerkClient } from "@clerk/nextjs/server";
import { addDays, subDays } from "date-fns";
import { buildIcsCalendar, shiftToCalendarEvent } from "@/lib/calendar-export";
import { verifyFeedToken } from "@/lib/calendar-feed";
import { dbGetScheduledShifts } from "@/lib/db";
import { orgHasPlanFeature, SCHEDULING_FEATURE } from "@/lib/plan-features";

/** How far back and ahead the feed reaches. */
const FEED_PAST_DAYS = 30;
const FEED_FUTURE_DAYS = 120;

const notFound = () =>
  new Response("Calendar not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

/**
 * A member's shifts as an iCalendar feed that calendar apps subscribe to.
 * Calendar apps can't sign in, so the signed token in the URL is the
 * credential; the member must still belong to the org, and the org must
 * still have Scheduling.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/calendar/[token]">,
) {
  const { token } = await ctx.params;
  const feed = verifyFeedToken(token.replace(/\.ics$/i, ""));
  if (!feed) return notFound();

  const client = await clerkClient();
  const memberships = await client.organizations
    .getOrganizationMembershipList({
      organizationId: feed.orgId,
      userId: [feed.userId],
    })
    .catch(() => null);
  const membership = memberships?.data.find(
    (m) => m.publicUserData?.userId === feed.userId,
  );
  if (!membership) return notFound();

  const hasScheduling = await orgHasPlanFeature(feed.orgId, SCHEDULING_FEATURE);
  const now = new Date();
  const shifts = hasScheduling
    ? await dbGetScheduledShifts(
        feed.orgId,
        feed.userId,
        subDays(now, FEED_PAST_DAYS),
        addDays(now, FEED_FUTURE_DAYS),
      )
    : [];
  const orgName = membership.organization?.name;
  const ics = buildIcsCalendar(
    shifts.map((shift) => shiftToCalendarEvent(shift)),
    now,
    orgName ? `Clock Out shifts · ${orgName}` : "Clock Out shifts",
  );

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="clock-out-shifts.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
}
