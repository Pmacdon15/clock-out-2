import { auth } from "@clerk/nextjs/server";
import { addDays } from "date-fns";
import { loadOrgMembers } from "./alerts-runner";
import { dbGetScheduledShifts } from "./db";
import { SCHEDULING_FEATURE, SCHEDULING_UPGRADE_REASON } from "./plan-features";
import {
  type ApprovedShiftRequest,
  type CreateShiftRequestInput,
  cancelShiftRequest,
  claimShiftRequest,
  createShiftRequest,
  reviewShiftRequest,
  type ShiftRequestActor,
} from "./shift-requests";
import {
  ACTIVE_SHIFT_REQUEST_STATUSES,
  dbGetShiftRequest,
  dbListShiftRequests,
} from "./shift-requests-db";
import type {
  SerializableResult,
  ShiftRequest,
  ShiftRequestDetail,
} from "./types";

/*
 * Shift swap and pickup requests for the Schedule page. The rules live in
 * shift-requests.ts (shared with MCP); this only works out who is signed in.
 */

/** An upcoming shift a member could offer, swap or ask to take. */
export type TradeableShift = {
  id: number;
  user_id: string;
  shift_start: Date;
  shift_end: Date;
};

/** How far ahead the Schedule page offers shifts for new requests. */
export const TRADEABLE_SHIFT_DAYS = 28;

export type ShiftRequestsView = {
  requests: ShiftRequestDetail[];
  /**
   * Upcoming shifts in the org with no live request on them, for the
   * new-request form. Only times and owners, no notes.
   */
  shifts: TradeableShift[];
  /** Display names by user id, for everyone in the requests. */
  names: Record<string, string>;
  userId: string;
  isAdmin: boolean;
};

type Failure = { ok: false; reason: string };

async function signedInActor(): Promise<
  { ok: true; actor: ShiftRequestActor } | Failure
> {
  const { userId, orgId, orgRole, has } = await auth.protect();
  if (!userId || !orgId) return { ok: false, reason: "Unauthorized" };
  if (!has({ feature: SCHEDULING_FEATURE })) {
    return { ok: false, reason: SCHEDULING_UPGRADE_REASON };
  }
  return {
    ok: true,
    actor: { userId, orgId, isAdmin: orgRole === "org:admin" },
  };
}

/** Live requests for upcoming shifts, with names, for the signed-in member. */
export async function getShiftRequestsView(): Promise<
  SerializableResult<ShiftRequestsView, { reason: string }>
> {
  const signedIn = await signedInActor();
  if (!signedIn.ok) return { ok: false, error: { reason: signedIn.reason } };
  const { actor } = signedIn;
  try {
    const now = new Date();
    const [requests, members, scheduled] = await Promise.all([
      dbListShiftRequests(actor.orgId, ACTIVE_SHIFT_REQUEST_STATUSES, now),
      loadOrgMembers(actor.orgId),
      dbGetScheduledShifts(
        actor.orgId,
        null,
        now,
        addDays(now, TRADEABLE_SHIFT_DAYS),
      ),
    ]);
    const taken = new Set(
      requests.flatMap((r) => [r.shift_id, r.swap_shift_id]),
    );
    const shifts = scheduled
      .filter((s) => !taken.has(s.id))
      .map(({ id, user_id, shift_start, shift_end }) => ({
        id,
        user_id,
        shift_start,
        shift_end,
      }));
    return {
      ok: true,
      value: {
        requests,
        shifts,
        names: Object.fromEntries(members.map((m) => [m.userId, m.name])),
        userId: actor.userId,
        isAdmin: actor.isAdmin,
      },
    };
  } catch (error) {
    console.error("Error fetching shift requests: ", error);
    return { ok: false, error: { reason: "Error fetching shift requests" } };
  }
}

export type ShiftRequestChange<T> =
  | {
      ok: true;
      value: T;
      /** The request after the change, with its shift's times. */
      detail: ShiftRequestDetail | undefined;
      actorId: string;
    }
  | Failure;

async function change<T>(
  label: string,
  act: (
    actor: ShiftRequestActor,
  ) => Promise<{ ok: true; value: T } | { ok: false; reason: string }>,
  requestOf: (value: T) => ShiftRequest,
): Promise<ShiftRequestChange<T>> {
  const signedIn = await signedInActor();
  if (!signedIn.ok) return signedIn;
  const { actor } = signedIn;
  try {
    const result = await act(actor);
    if (!result.ok) return { ok: false, reason: result.reason };
    return {
      ok: true,
      value: result.value,
      detail: await dbGetShiftRequest(requestOf(result.value).id, actor.orgId),
      actorId: actor.userId,
    };
  } catch (error) {
    console.error(`Failed to ${label}: `, error);
    return { ok: false, reason: `Failed to ${label}` };
  }
}

const itself = (request: ShiftRequest) => request;

/** Offers your shift, asks to swap it, or asks to take a coworker's. */
export function createShiftRequestDal(input: CreateShiftRequestInput) {
  return change(
    "create the request",
    (actor) => createShiftRequest(actor, input),
    itself,
  );
}

/** Claims an offered shift, or accepts a pickup or swap sent to you. */
export function claimShiftRequestDal(id: number) {
  return change(
    "claim the shift",
    (actor) => claimShiftRequest(actor, id),
    itself,
  );
}

/** Withdraws your request, declines one sent to you, or (admins) cancels. */
export function cancelShiftRequestDal(id: number) {
  return change(
    "cancel the request",
    (actor) => cancelShiftRequest(actor, id),
    itself,
  );
}

/** Admins: approves a request and moves the shift(s) on the schedule. */
export function approveShiftRequestDal(id: number) {
  return change(
    "approve the request",
    async (actor) => {
      const result = await reviewShiftRequest(actor, id, "approved");
      if (!result.ok) return result;
      return { ok: true, value: result.value as ApprovedShiftRequest };
    },
    (value) => value.request,
  );
}

/** Admins: denies a request; the schedule stays as it is. */
export function denyShiftRequestDal(id: number) {
  return change(
    "deny the request",
    async (actor) => {
      const result = await reviewShiftRequest(actor, id, "denied");
      if (!result.ok) return result;
      return { ok: true, value: result.value as ShiftRequest };
    },
    itself,
  );
}
