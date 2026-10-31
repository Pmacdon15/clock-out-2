"use server";

import { auth } from "@clerk/nextjs/server";
import { startOfDay, subDays } from "date-fns";
import { updateTag } from "next/cache";
import {
  clockIn as dalClockIn,
  clockOut as dalClockOut,
  deleteBreakDal as dalDeleteBreak,
  deleteTimeEntry as dalDeleteTimeEntry,
  endBreak as dalEndBreak,
  startBreak as dalStartBreak,
  updateBreakDal as dalUpdateBreak,
  updateTimeEntry as dalUpdateTimeEntry,
  updateBreakSettingsDal,
  updateReportingSettingsDal,
} from "./dal";
import { sendWeeklyReports } from "./reports";
import type { BreakType } from "./types";

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

/**
 * Break records change the hours a shift is worth, so every break mutation
 * invalidates the member's entries and the org-wide list the Hours view and
 * the exports read from.
 */
function updateBreakTags(entry: { user_id: string; org_id: string }) {
  if (entry.user_id) {
    updateTag(`time-entries-${entry.user_id}-${entry.org_id}`);
  }
  updateTag(`org-time-entries-${entry.org_id}`);
}

export async function startBreakAction(breakType: BreakType = "unpaid_meal") {
  const result = await dalStartBreak(breakType);

  return result.match(
    (brk) => {
      updateBreakTags(brk);
      return { success: true, data: brk };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function endBreakAction() {
  const result = await dalEndBreak();

  return result.match(
    (brk) => {
      updateBreakTags(brk);
      return { success: true, data: brk };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function updateBreakAction(
  id: number,
  break_start: string,
  break_end: string | null,
  break_type: BreakType,
) {
  const result = await dalUpdateBreak(
    id,
    new Date(break_start),
    break_end ? new Date(break_end) : null,
    break_type,
  );

  return result.match(
    (brk) => {
      updateBreakTags(brk);
      return { success: true, data: brk };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}

export async function deleteBreakAction(id: number) {
  const result = await dalDeleteBreak(id);

  return result.match(
    (brk) => {
      updateBreakTags(brk);
      return { success: true };
    },
    (err) => {
      return { success: false, error: err.reason };
    },
  );
}
