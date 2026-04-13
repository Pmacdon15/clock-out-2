"use server";

import { updateTag } from "next/cache";
import {
  clockIn as dalClockIn,
  clockOut as dalClockOut,
  deleteTimeEntry as dalDeleteTimeEntry,
  updateTimeEntry as dalUpdateTimeEntry,
} from "./dal";
import { auth } from "@clerk/nextjs/server";
import { sendWeeklyReports } from "./reports";
import { startOfDay, subDays } from "date-fns";

export async function clockInAction() {
  const result = await dalClockIn();

  return result.match(
    (entry) => {
      updateTag(`time-entries-${entry.user_id}-${entry.org_id}`);
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
      updateTag(`time-entries-${entry.user_id}-${entry.org_id}`);
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
      updateTag(`time-entries-${entry.user_id}-${entry.org_id}`);
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
) {
  const result = await dalUpdateTimeEntry(
    id,
    new Date(clock_in),
    clock_out ? new Date(clock_out) : null,
  );

  return result.match(
    (entry) => {
      updateTag(`time-entries-${entry.user_id}-${entry.org_id}`);
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

