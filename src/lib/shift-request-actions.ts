"use server";

import { refresh, updateTag } from "next/cache";
import { after } from "next/server";
import {
  mirrorReassignedShifts,
  notifyShiftRequest,
  type ShiftRequestEvent,
} from "./shift-request-notify";
import type { CreateShiftRequestInput } from "./shift-requests";
import {
  approveShiftRequestDal,
  cancelShiftRequestDal,
  claimShiftRequestDal,
  createShiftRequestDal,
  denyShiftRequestDal,
  type ShiftRequestChange,
} from "./shift-requests-dal";
import type { ShiftRequest } from "./types";

type ActionResult = { success: true } | { success: false; error: string };

/** Answers the page and tells the people involved once it has. */
function respond<T>(
  result: ShiftRequestChange<T>,
  event: ShiftRequestEvent,
  requestOf: (value: T) => ShiftRequest,
  timezone?: string | null,
): ActionResult {
  if (!result.ok) return { success: false, error: result.reason };
  // Re-render the Schedule page so the card shows the change.
  refresh();
  const { detail, actorId } = result;
  if (detail) {
    after(() =>
      notifyShiftRequest(
        event,
        requestOf(result.value),
        detail,
        actorId,
        timezone,
      ),
    );
  }
  return { success: true };
}

const itself = (request: ShiftRequest) => request;

export async function createShiftRequestAction(
  input: CreateShiftRequestInput,
  timezone?: string | null,
) {
  return respond(
    await createShiftRequestDal(input),
    "created",
    itself,
    timezone,
  );
}

export async function claimShiftRequestAction(
  id: number,
  timezone?: string | null,
) {
  return respond(await claimShiftRequestDal(id), "claimed", itself, timezone);
}

export async function cancelShiftRequestAction(
  id: number,
  timezone?: string | null,
) {
  return respond(
    await cancelShiftRequestDal(id),
    "cancelled",
    itself,
    timezone,
  );
}

export async function denyShiftRequestAction(
  id: number,
  timezone?: string | null,
) {
  return respond(await denyShiftRequestDal(id), "denied", itself, timezone);
}

export async function approveShiftRequestAction(
  id: number,
  timezone?: string | null,
) {
  const result = await approveShiftRequestDal(id);
  if (result.ok) {
    const { request, shifts, previous } = result.value;
    updateTag(`scheduled-shifts-${request.org_id}`);
    after(() => mirrorReassignedShifts(previous, shifts));
  }
  return respond(result, "approved", (value) => value.request, timezone);
}
