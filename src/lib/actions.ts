"use server";

import { updateTag } from "next/cache";
import {
  clockIn as dalClockIn,
  clockOut as dalClockOut,
  deleteTimeEntry as dalDeleteTimeEntry,
  updateTimeEntry as dalUpdateTimeEntry,
} from "./dal";

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
