import { auth, clerkClient } from "@clerk/nextjs/server";
import {
  endOfDay,
  endOfMonth,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfYear,
} from "date-fns";
import { errAsync, okAsync } from "neverthrow";
import {
  dbCheckActiveEntry,
  dbClockIn,
  dbClockOut,
  dbDeleteTimeEntry,
  dbGetOrgTimeEntries,
  dbGetReportingSettings,
  dbGetTimeEntries,
  dbUpdateReportingSettings,
  dbUpdateTimeEntry,
  sql,
} from "./db";
import type {
  ReportingSettingsData,
  SerializableResult,
  TimeEntry,
} from "./types";
import { getProcessedMembers, isOverMemberShipLimit } from "./utils-clerk";

export type { SerializableResult, TimeEntry };

export function getDateRange(params: {
  timeframe?: string;
  week?: string;
  month?: string;
  year?: string;
  start?: string;
  end?: string;
}) {
  const now = new Date();
  const timeframe = params.timeframe || "week";
  const selectedYear = params.year
    ? parseInt(params.year, 10)
    : now.getFullYear();
  const selectedMonth = params.month
    ? parseInt(params.month, 10)
    : now.getMonth();
  const selectedWeek = params.week ? parseInt(params.week, 10) : 1;

  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (timeframe === "week") {
    if (selectedWeek === 1) {
      startDate = startOfDay(new Date(selectedYear, selectedMonth, 1));
      endDate = endOfDay(new Date(selectedYear, selectedMonth, 7));
    } else if (selectedWeek === 2) {
      startDate = startOfDay(new Date(selectedYear, selectedMonth, 8));
      endDate = endOfDay(new Date(selectedYear, selectedMonth, 15));
    } else if (selectedWeek === 3) {
      startDate = startOfDay(new Date(selectedYear, selectedMonth, 16));
      endDate = endOfDay(new Date(selectedYear, selectedMonth, 23));
    } else {
      startDate = startOfDay(new Date(selectedYear, selectedMonth, 24));
      endDate = endOfMonth(new Date(selectedYear, selectedMonth, 1));
    }
  } else if (timeframe === "month") {
    startDate = startOfMonth(new Date(selectedYear, selectedMonth, 1));
    endDate = endOfMonth(new Date(selectedYear, selectedMonth, 1));
  } else if (timeframe === "year") {
    startDate = startOfYear(new Date(selectedYear, 0, 1));
    endDate = endOfYear(new Date(selectedYear, 0, 1));
  } else if (timeframe === "custom" && params.start && params.end) {
    startDate = startOfDay(new Date(`${params.start}T00:00:00`));
    endDate = endOfDay(new Date(`${params.end}T00:00:00`));
  }

  return { startDate, endDate };
}


export async function getOrgMembers() {
  const { orgId, orgRole } = await auth.protect();

  if (!orgId || orgRole !== "org:admin") {
    return [];
  }


return clerkClient()
    .then((client) =>
        client.organizations.getOrganizationMembershipList({
            organizationId: orgId,
        })
    )
    .then((response) => getProcessedMembers(orgId,JSON.parse(JSON.stringify(response.data))))
    .catch((error) => {
        console.error('Error fetching members:', error)
        return []
    })
  
}
export async function getTimeEntries(
  targetUserId?: string,
  filters?: {
    timeframe?: string;
    week?: string;
    month?: string;
    year?: string;
    start?: string;
    end?: string;
  },
): Promise<SerializableResult<TimeEntry[], { reason: string }>> {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId) {
    return {
      error: { reason: "Unauthorized or no organization selected" },
      ok: false,
    };
  }

  const queryUserId = targetUserId || userId;
  const isAdmin = orgRole === "org:admin";

  if (queryUserId !== userId && !isAdmin) {
    return {
      error: {
        reason: "Forbidden: You do not have permission to view these entries",
      },
      ok: false,
    };
  }

  const { startDate, endDate } = filters
    ? getDateRange(filters)
    : { startDate: undefined, endDate: undefined };

  try {
    const rows = await dbGetTimeEntries(queryUserId, orgId, startDate, endDate);
    return { value: rows, ok: true };
  } catch (error) {
    console.error("DB error: ", error);
    return { error: { reason: "Unknown DB error" }, ok: false };
  }
}

export async function getOrgTimeEntries(filters?: {
  timeframe?: string;
  week?: string;
  month?: string;
  year?: string;
  start?: string;
  end?: string;
}): Promise<SerializableResult<TimeEntry[], { reason: string }>> {
  const { userId, orgId, orgRole } = await auth.protect();
  const isAdmin = orgRole === "org:admin";

  if (!userId || !orgId || !isAdmin) {
    return {
      error: {
        reason: "Unauthorized: You must be an admin to view organization stats",
      },
      ok: false,
    };
  }

  const { startDate, endDate } = filters
    ? getDateRange(filters)
    : { startDate: undefined, endDate: undefined };

  try {
    const rows = await dbGetOrgTimeEntries(orgId, startDate, endDate);
    return { value: rows, ok: true };
  } catch (error) {
    console.error("DB error: ", error);
    return { error: { reason: "Unknown DB error" }, ok: false };
  }
}

export async function clockIn() {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({
      reason: "Unauthorized or no organization selected",
    } as const);
  }

  const isOverMemberShipLimitValue = await isOverMemberShipLimit(orgId);
  if (isOverMemberShipLimitValue)
    return errAsync({
      reason: "Over organization membership limit.",
    } as const);

  try {
    const activeEntry = await dbCheckActiveEntry(userId, orgId);

    if (activeEntry.length > 0) {
      return errAsync({ reason: "Already clocked in" } as const);
    }

    const newEntry = await dbClockIn(userId, orgId);

    return okAsync(newEntry);
  } catch (error) {
    console.error("DB error: ", error);
    return errAsync({ reason: "Unknown DB error" } as const);
  }
}

export async function clockOut() {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({
      reason: "Unauthorized or no organization selected",
    } as const);
  }
  try {
    const activeEntry = await dbClockOut(userId, orgId);

    if (!activeEntry) {
      return errAsync({ reason: "No active clock-in found" } as const);
    }

    return okAsync(activeEntry);
  } catch (error) {
    console.error("DB error: ", error);
    return errAsync({ reason: "Unknown DB error" } as const);
  }
}

export async function deleteTimeEntry(id: number) {
  const { userId, orgId, orgRole } = await auth.protect();
  const isAdmin = orgRole === "org:admin";
  if (!userId || !orgId || !isAdmin) {
    return errAsync({ reason: "Unauthorized" } as const);
  }

  try {
    const deleted = await dbDeleteTimeEntry(id, orgId);

    return deleted
      ? okAsync(deleted)
      : errAsync({ reason: "Entry not found or unauthorized" } as const);
  } catch (error) {
    console.error("Delete error: ", error);
    return errAsync({ reason: "Failed to delete entry" } as const);
  }
}

export async function updateTimeEntry(
  id: number,
  clock_in: Date,
  clock_out: Date | null,
) {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId) {
    return errAsync({ reason: "Unauthorized" } as const);
  }
  const isAdmin = orgRole === "org:admin";

  try {
    const updated = await dbUpdateTimeEntry(
      id,
      clock_in,
      clock_out,
      orgId,
      isAdmin,
    );

    return updated
      ? okAsync(updated)
      : errAsync({ reason: "Entry not found or unauthorized" } as const);
  } catch (error) {
    console.error("Update error: ", error);
    return errAsync({ reason: "Failed to update entry" } as const);
  }
}

export async function getActiveEntry(): Promise<
  SerializableResult<TimeEntry | null, { reason: string }>
> {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return {
      error: { reason: "Unauthorized or no organization selected" },
      ok: false,
    };
  }

  try {
    const [activeEntry] = await sql`
            SELECT * FROM time_entries 
            WHERE user_id = ${userId} AND org_id = ${orgId} AND clock_out IS NULL
            LIMIT 1
        `;
    return {
      value: (activeEntry as unknown as TimeEntry) || null,
      ok: true,
    };
  } catch (error) {
    console.error("DB error: ", error);
    return { error: { reason: "Unknown DB error" }, ok: false };
  }
}

export async function updateReportingSettingsDal(
  frequency: string,
  day: string | null = null,
  interval: number = 1,
) {
  const { userId, orgId, orgRole, has } = await auth.protect();
  const isAdmin = orgRole === "org:admin";
  const hasReporting = has({ feature: "reporting" });

  if (!userId || !orgId || !isAdmin || !hasReporting) {
    return errAsync({ reason: "Unauthorized" } as const);
  }

  // const isPaidPlan = !has({ plan: 'free' })

  // if (!isPaidPlan) {
  // 	return errAsync({
  // 		reason: 'Reports settings are only available on paid plans',
  // 	} as const)
  // }

  try {
    const updated = await dbUpdateReportingSettings(
      orgId,
      frequency,
      day,
      interval,
    );
    return okAsync(updated);
  } catch (error) {
    console.error("Update settings error: ", error);
    return errAsync({ reason: "Failed to update settings" } as const);
  }
}

export async function getOrgReportingSettings(): Promise<
  SerializableResult<ReportingSettingsData | null, { reason: string }>
> {
  const { userId, orgId } = await auth.protect();
  if (!userId || !orgId) {
    return {
      error: { reason: "Unauthorized or no organization selected" },
      ok: false,
    };
  }

  try {
    const settings = await dbGetReportingSettings(orgId);
    return {
      value: (settings as unknown as ReportingSettingsData) || null,
      ok: true,
    };
  } catch (error) {
    console.error("DB error: ", error);
    return { error: { reason: "Unknown DB error" }, ok: false };
  }
}
