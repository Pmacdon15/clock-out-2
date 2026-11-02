import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { clerkClient } from "@clerk/nextjs/server";
import { render } from "@react-email/render";
import { format, subDays } from "date-fns";
import { WeeklyReportEmail } from "@/components/emails/WeeklyReportEmail";
import {
  breakTypeLabel,
  getBreakDurationMs,
  getEffectiveDurationMs,
  isPaidBreakType,
} from "./break-utils";
import { fetchAllPages } from "./clerk-pagination";
import {
  dbGetApprovedTimeOffForPeriod,
  dbGetBreakSettings,
  dbGetOvertimeSettings,
  dbGetTimeEntriesForPeriod,
} from "./db";
import {
  computeEntryOvertime,
  describeOvertime,
  isOvertimeEnabled,
  type OvertimeSplit,
} from "./overtime";
import {
  formatTimeOffDates,
  formatTimeOffHours,
  isPaidTimeOff,
  TIME_OFF_TYPE_LABELS,
  timeOffHoursInRange,
} from "./time-off-utils";

const sesClient = new SESClient({
  region: process.env.AWS_REGION || "us-east-1",
});

function formatDuration(ms: number) {
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Whether the organization's Clerk billing subscription includes the paid
 * "reporting" feature. Any billing error (no subscription, etc.) counts as no.
 */
export async function orgHasReportingFeature(orgId: string): Promise<boolean> {
  try {
    const client = await clerkClient();
    const subscription =
      await client.billing.getOrganizationBillingSubscription(orgId);
    return subscription.subscriptionItems.some(
      (item: { plan?: { features?: { slug: string }[] } | null }) =>
        item.plan?.features?.some(
          (f: { slug: string }) => f.slug === "reporting",
        ),
    );
  } catch (_error) {
    console.log(`[Reports] No billing/subscription for org ${orgId}`);
    return false;
  }
}

export type SendReportOptions = {
  /** Only email reports for these members (defaults to every member). */
  userIds?: string[];
};

export async function sendWeeklyReports(
  startDate: Date,
  endDate: Date,
  targetOrgId?: string,
  timeframe: string = "week",
  options: SendReportOptions = {},
) {
  const hasAwsCreds =
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY;
  if (!hasAwsCreds) {
    console.warn("AWS credentials are not defined. Skipping email sending.");
    return false;
  }

  const client = await clerkClient();

  let allOrgs = [];
  if (targetOrgId) {
    const org = await client.organizations.getOrganization({
      organizationId: targetOrgId,
    });
    allOrgs = [org];
  } else {
    // Fetch all organizations in the instance, page by page
    allOrgs = await fetchAllPages(
      (params) => client.organizations.getOrganizationList(params),
      { label: "organizations" },
    );
  }

  console.log(`[Reports] Found ${allOrgs.length} organizations to process.`);

  // Process each organization
  for (const org of allOrgs) {
    const orgId = org.id;

    const hasReportingFeature = await orgHasReportingFeature(orgId);

    if (!hasReportingFeature) {
      console.log(
        `[Reports] Organization ${org.name} (${orgId}) does not have the 'reporting' feature. Skipping reports.`,
      );
      continue;
    }

    console.log(`[Reports] Processing Organization: ${org.name} (${orgId})`);

    // Get every member of this org, not just the first page. A failure part
    // way through throws out of this org only: the cron records it and reports
    // already emailed for earlier orgs stay sent.
    const members = await fetchAllPages(
      (params) =>
        client.organizations.getOrganizationMembershipList({
          organizationId: orgId,
          ...params,
        }),
      { label: `members of ${orgId}` },
    );
    console.log(
      `[Reports] Found ${members.length} members in organization ${org.name}.`,
    );

    // Find admins to send emails to
    const adminEmails = members
      .filter((m) => {
        const isAdmin = m.role === "org:admin";
        const hasEmail = !!m.publicUserData?.identifier;
        return isAdmin && hasEmail;
      })
      .map((m) => m.publicUserData?.identifier as string);

    console.log(`[Reports] Admin emails found:`, adminEmails);

    if (adminEmails.length === 0) {
      console.log(
        `[Reports] No admins found for organization ${org.name}. Skipping.`,
      );
      continue;
    }

    const breakSettings = await dbGetBreakSettings(orgId);
    // A lookup failure sends the report without overtime rather than none.
    const overtimeSettings = await Promise.resolve()
      .then(() => dbGetOvertimeSettings(orgId))
      .catch((error) => {
        console.error(
          `[Reports] Error fetching overtime settings for ${orgId}:`,
          error,
        );
        return undefined;
      });
    const overtimeEnabled = isOvertimeEnabled(overtimeSettings);

    // Generate report for each member, even non-admins
    for (const member of members) {
      const publicUserData = member.publicUserData;
      const userId = publicUserData?.userId;
      if (!userId) continue;
      if (options.userIds && !options.userIds.includes(userId)) continue;

      const userName = publicUserData.firstName
        ? `${publicUserData.firstName} ${publicUserData.lastName || ""}`.trim()
        : publicUserData.identifier;

      console.log(
        `[Reports] Fetching entries for member: ${userName} (${userId})`,
      );

      const entries = await dbGetTimeEntriesForPeriod(
        userId,
        orgId,
        startDate,
        endDate,
      );

      const overtimeByEntry = computeEntryOvertime(
        entries.filter((entry) => entry.clock_out),
        overtimeSettings,
        breakSettings,
      );

      let totalMs = 0;
      let overtimeMs = 0;
      const dailyBreakdownMap = new Map<
        string,
        {
          date: string;
          rawMs: number;
          overtimeMs: number;
          shifts: {
            start: string;
            end: string;
            duration: string;
            breaks?: string;
            overtime?: string;
          }[];
        }
      >();

      for (const entry of entries) {
        if (!entry.clock_out) continue; // Skip incomplete entries

        const inDate = new Date(entry.clock_in);
        const outDate = new Date(entry.clock_out);
        const durationMs = getEffectiveDurationMs(entry, breakSettings);
        // Every completed entry has a split (all zero without thresholds).
        const shiftOvertimeMs = Math.round(
          (overtimeByEntry.get(entry) as OvertimeSplit).overtimeHours *
            3_600_000,
        );

        totalMs += durationMs;
        overtimeMs += shiftOvertimeMs;

        const dateKey = format(inDate, "MMM d, yyyy");
        let dayData = dailyBreakdownMap.get(dateKey);
        if (!dayData) {
          dayData = { date: dateKey, rawMs: 0, overtimeMs: 0, shifts: [] };
          dailyBreakdownMap.set(dateKey, dayData);
        }

        // Breaks are listed per shift: the meal-period record regulators ask
        // for, and the reason the unpaid ones are missing from the duration.
        const breakLines = (entry.breaks ?? []).map((brk) => {
          const minutes = Math.round(getBreakDurationMs(brk) / 60_000);
          const paid = isPaidBreakType(brk.break_type) ? "paid" : "unpaid";
          return `${breakTypeLabel(brk.break_type)} ${format(
            new Date(brk.break_start),
            "h:mm a",
          )} - ${
            brk.break_end ? format(new Date(brk.break_end), "h:mm a") : "..."
          } (${minutes}m, ${paid})`;
        });

        dayData.rawMs += durationMs;
        dayData.overtimeMs += shiftOvertimeMs;
        dayData.shifts.push({
          start: format(inDate, "h:mm a"),
          end: format(outDate, "h:mm a"),
          duration: formatDuration(durationMs),
          ...(breakLines.length > 0 ? { breaks: breakLines.join("; ") } : {}),
          ...(shiftOvertimeMs > 0
            ? { overtime: formatDuration(shiftOvertimeMs) }
            : {}),
        });
      }

      console.log(
        `[Reports] Member ${userName} has ${entries.length} entries for this period.`,
      );

      // Convert breakdown map to array
      const breakdown = Array.from(dailyBreakdownMap.values());

      const totalHoursString = formatDuration(totalMs);
      const toHours = (ms: number) => parseFloat((ms / 3_600_000).toFixed(2));

      // Generate Chart URL. With overtime tracked, each day's bar is split
      // into stacked regular and overtime segments.
      const chartConfig = {
        type: "bar",
        data: {
          labels: breakdown.map((b) => b.date.split(",")[0]), // "Apr 5"
          datasets: overtimeEnabled
            ? [
                {
                  label: "Regular",
                  data: breakdown.map((b) => toHours(b.rawMs - b.overtimeMs)),
                  backgroundColor: "rgba(59, 130, 246, 0.7)",
                },
                {
                  label: "Overtime",
                  data: breakdown.map((b) => toHours(b.overtimeMs)),
                  backgroundColor: "rgba(234, 88, 12, 0.8)",
                },
              ]
            : [
                {
                  label: "Hours Logged",
                  data: breakdown.map((b) => toHours(b.rawMs)),
                  backgroundColor: "rgba(59, 130, 246, 0.7)",
                },
              ],
        },
        options: {
          plugins: { legend: { display: overtimeEnabled } },
          scales: {
            xAxes: [{ stacked: true }], // v2
            yAxes: [{ stacked: true, ticks: { beginAtZero: true, min: 0 } }], // v2
            x: { stacked: true }, // v3
            y: { stacked: true, beginAtZero: true, min: 0 }, // v3
          },
        },
      };
      const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=500&h=300`;

      // If endDate is exactly at start of day, the inclusive end date is the previous day.
      // Otherwise, it is today.
      const isStartOfDay =
        endDate.getHours() === 0 &&
        endDate.getMinutes() === 0 &&
        endDate.getSeconds() === 0 &&
        endDate.getMilliseconds() === 0;
      const inclusiveEndDate = isStartOfDay ? subDays(endDate, 1) : endDate;

      // Render React Email
      const periodStartStr = format(startDate, "MMM d, yyyy");
      const periodEndStr = format(inclusiveEndDate, "MMM d, yyyy");

      const customStart = format(startDate, "yyyy-MM-dd");
      const customEnd = format(inclusiveEndDate, "yyyy-MM-dd");

      // Approved time off is reported beside the worked hours, not in them.
      // A failed lookup leaves it out rather than holding back the report.
      const timeOff = await Promise.resolve()
        .then(() =>
          dbGetApprovedTimeOffForPeriod(userId, orgId, customStart, customEnd),
        )
        .catch((error) => {
          console.error(
            `[Reports] Error fetching time off for ${userName}:`,
            error,
          );
          return [];
        });
      let timeOffHours = 0;
      let unpaidTimeOffHours = 0;
      const timeOffLines = timeOff.map((request) => {
        const hours = timeOffHoursInRange(request, customStart, customEnd);
        if (isPaidTimeOff(request.request_type)) timeOffHours += hours;
        else unpaidTimeOffHours += hours;
        return {
          type: TIME_OFF_TYPE_LABELS[request.request_type],
          dates: formatTimeOffDates(request),
          hours: formatTimeOffHours(hours),
        };
      });

      // Map startDate to the 1-4 week indexing used in ViewHours UI
      const dayOfMonth = startDate.getDate();
      let weekIndex = 1;
      if (dayOfMonth >= 22) weekIndex = 4;
      else if (dayOfMonth >= 15) weekIndex = 3;
      else if (dayOfMonth >= 8) weekIndex = 2;

      if (entries.length > 0 || timeOffLines.length > 0) {
        console.log(
          `[Reports] Sending email for ${userName} to admins: ${adminEmails.join(", ")}`,
        );
        try {
          const emailHtml = await render(
            WeeklyReportEmail({
              userName,
              totalHours: totalHoursString,
              ...(overtimeEnabled
                ? {
                    regularHours: formatDuration(totalMs - overtimeMs),
                    overtimeHours: formatDuration(overtimeMs),
                    overtimePolicy: describeOvertime(overtimeSettings),
                  }
                : {}),
              periodStart: periodStartStr,
              periodEnd: periodEndStr,
              chartUrl,
              dashboardUrl:
                process.env.NEXT_PUBLIC_APP_URL || "https://clockout.patmac.ca",
              userId: userId,
              orgId: orgId,
              week: weekIndex.toString(),
              month: startDate.getMonth().toString(),
              year: startDate.getFullYear().toString(),
              timeframe,
              customStart,
              customEnd,
              breakdown: breakdown.map(({ overtimeMs, ...day }) => ({
                ...day,
                ...(overtimeMs > 0
                  ? { overtime: formatDuration(overtimeMs) }
                  : {}),
              })),
              timeOff: timeOffLines,
              totalTimeOff: formatTimeOffHours(timeOffHours),
              ...(unpaidTimeOffHours > 0
                ? { totalUnpaidTimeOff: formatTimeOffHours(unpaidTimeOffHours) }
                : {}),
            }),
          );

          const command = new SendEmailCommand({
            Destination: {
              ToAddresses: adminEmails,
            },
            Message: {
              Body: {
                Html: {
                  Charset: "UTF-8",
                  Data: emailHtml,
                },
              },
              Subject: {
                Charset: "UTF-8",
                Data:
                  timeframe === "custom"
                    ? `Hours Report for ${userName} (${periodStartStr} – ${periodEndStr})`
                    : `Weekly Hours Report for ${userName}`,
              },
            },
            Source:
              process.env.SES_FROM_EMAIL ||
              "Clock Out <no-reply@clockout.patmac.ca>",
          });

          const data = await sesClient.send(command);
          console.log(`[Reports] SES Success for ${userName}:`, data);
        } catch (error) {
          console.error(
            `[Reports] Catch Error sending email for ${userName}:`,
            error,
          );
        }
      } else {
        console.log(
          `[Reports] No completed entries or time off for ${userName}. Skipping email.`,
        );
      }
    }
  }

  return true;
}
