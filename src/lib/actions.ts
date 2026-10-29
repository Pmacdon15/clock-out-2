"use server";

import { auth } from "@clerk/nextjs/server";
import { startOfDay, subDays } from "date-fns";
import { updateTag } from "next/cache";
import {
  clockIn as dalClockIn,
  clockOut as dalClockOut,
  deleteTimeEntry as dalDeleteTimeEntry,
  updateTimeEntry as dalUpdateTimeEntry,
  updateBreakSettingsDal,
  updateReportingSettingsDal,
} from "./dal";
import { sendWeeklyReports } from "./reports";

export async function clockInAction() {
  const result = await dalClockIn();

  return result.match(
    (entry) => {
      if (entry) updateTag(`time-entries-${entry.user_id}-${entry.org_id}`);
      return { success: true, data: entry };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function clockOutAction() {
  const result = await dalClockOut();

  return result.match(
    (entry) => {
      if (entry) {
        updateTag(`time-entries-${entry.user_id}-${entry.org_id}`);
        updateTag(`org-time-entries-${entry.org_id}`);
      }
      return { success: true, data: entry };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function deleteTimeEntryAction(id: number) {
  const result = await dalDeleteTimeEntry(id);

  return result.match(
    (entry) => {
      if (entry) {
        updateTag(`time-entries-${entry.user_id}-${entry.org_id}`);
        updateTag(`org-time-entries-${entry.org_id}`);
      }
      return { success: true };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function updateTimeEntryAction(
  id: number,
  clock_in: string,
  clock_out: string | null,
  skip_lunch?: boolean,
) {
  const clockInDate = new Date(clock_in);
  const clockOutDate = clock_out ? new Date(clock_out) : null;
  const result =
    skip_lunch === undefined
      ? await dalUpdateTimeEntry(id, clockInDate, clockOutDate)
      : await dalUpdateTimeEntry(id, clockInDate, clockOutDate, skip_lunch);

  return result.match(
    (entry) => {
      if (entry) {
        updateTag(`time-entries-${entry.user_id}-${entry.org_id}`);
        updateTag(`org-time-entries-${entry.org_id}`);
      }
      return { success: true, data: entry };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function sendCurrentWeekReportAction() {
  const { userId, orgId, orgRole } = await auth.protect();
  if (!userId || !orgId) {
    return { success: false, error: "Unauthorized" };
  }
  const isAdmin = orgRole === "org:admin";
  if (!isAdmin) {
    return { success: false, error: "Only admins can test reports" };
  }

  const endDate = new Date();
  const startDate = startOfDay(subDays(endDate, 7));

  await sendWeeklyReports(startDate, endDate, orgId);
  return { success: true };
}

export async function updateOrgSettingAction(
  frequency: string,
  day: string | null = null,
  interval: number = 1,
) {
  const result = await updateReportingSettingsDal(frequency, day, interval);

  return result.match(
    (entry) => {
      // updateTag(`settings-${entry.org_id}`)
      updateTag(`reporting-settings-${entry.org_id}`);
      return { success: true, data: entry };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function updateBreakSettingAction(
  dockLunch: boolean,
  durationMinutes: number = 30,
  minShiftHours: number = 5,
) {
  const result = await updateBreakSettingsDal(
    dockLunch,
    durationMinutes,
    minShiftHours,
  );

  return result.match(
    (entry) => {
      updateTag(`break-settings-${entry.org_id}`);
      return { success: true, data: entry };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}
