import { dbGetApprovedTimeOffForPeriod, dbGetScheduledShiftById } from "./db";
import {
  dbApproveShiftRequest,
  dbCancelShiftRequest,
  dbClaimShiftRequest,
  dbCreateShiftRequest,
  dbDenyShiftRequest,
  dbGetOverlappingScheduledShifts,
  dbGetShiftRequest,
} from "./shift-requests-db";
import { formatTimeOffDates, shiftCalendarDays } from "./time-off-utils";
import type {
  ScheduledShift,
  ShiftRequest,
  ShiftRequestDetail,
  ShiftRequestStatus,
  ShiftRequestType,
} from "./types";

/*
 * The rules for shift swap and pickup requests, shared by the MCP tools and
 * the Schedule page. Callers check the org's plan (Scheduling) and pass who
 * is acting; everything else (who may do what, in which state, and whether
 * the people involved are free to work the shift) is decided here.
 */

export type ShiftRequestActor = {
  userId: string;
  orgId: string;
  isAdmin: boolean;
};

export type ShiftRequestFailureStatus =
  | "invalid_input"
  | "forbidden"
  | "not_found"
  | "not_open"
  | "not_pending"
  | "shift_started"
  | "own_shift"
  | "already_requested"
  | "schedule_conflict"
  | "time_off_conflict"
  | "shift_changed";

export type ShiftRequestFailure = {
  ok: false;
  status: ShiftRequestFailureStatus;
  reason: string;
};

export type ShiftRequestOutcome<T> =
  | { ok: true; value: T }
  | ShiftRequestFailure;

export const MAX_SHIFT_REQUEST_NOTE_LENGTH = 500;

export const SHIFT_REQUEST_TYPE_LABELS: Record<ShiftRequestType, string> = {
  offer: "Offered shift",
  pickup: "Pickup request",
  swap: "Shift swap",
};

export const SHIFT_REQUEST_STATUS_LABELS: Record<ShiftRequestStatus, string> = {
  open: "Open",
  pending_approval: "Waiting for approval",
  approved: "Approved",
  denied: "Denied",
  cancelled: "Cancelled",
};

const fail = (
  status: ShiftRequestFailureStatus,
  reason: string,
): ShiftRequestFailure => ({ ok: false, status, reason });

/**
 * Who gives up `shift_id` and who takes it. For a swap the giver also takes
 * `swap_shift_id` from the taker. `taker` is null for an unclaimed offer.
 */
export function shiftRequestParties(
  request: Pick<
    ShiftRequest,
    "request_type" | "requested_by" | "target_user_id" | "claimed_by"
  >,
): { giver: string; taker: string | null } {
  return {
    giver:
      request.request_type === "pickup"
        ? (request.target_user_id as string)
        : request.requested_by,
    taker: request.claimed_by,
  };
}

/** The member whose answer an open pickup or swap waits for. */
const answerer = (request: ShiftRequest) =>
  request.request_type === "offer" ? null : request.target_user_id;

/** Whether `userId` could claim (offer) or accept (pickup/swap) the request. */
export function canClaimShiftRequest(request: ShiftRequest, userId: string) {
  if (request.status !== "open") return false;
  if (request.request_type === "offer") {
    return (
      request.requested_by !== userId &&
      (request.target_user_id === null || request.target_user_id === userId)
    );
  }
  return request.target_user_id === userId;
}

/** Whether `userId` (an admin when `isAdmin`) could cancel or decline it. */
export function canCancelShiftRequest(
  request: ShiftRequest,
  userId: string,
  isAdmin: boolean,
) {
  if (request.status !== "open" && request.status !== "pending_approval") {
    return false;
  }
  return (
    isAdmin ||
    request.requested_by === userId ||
    (request.status === "open" && answerer(request) === userId)
  );
}

/** Splits requests into what a member can act on and what is theirs. */
export function groupShiftRequestsFor<T extends ShiftRequest>(
  requests: T[],
  userId: string,
) {
  const available: T[] = [];
  const awaitingYou: T[] = [];
  const yours: T[] = [];
  for (const r of requests) {
    if (canClaimShiftRequest(r, userId)) {
      (r.request_type === "offer" ? available : awaitingYou).push(r);
    } else if (r.requested_by === userId || r.claimed_by === userId) {
      yours.push(r);
    }
  }
  return { available, awaitingYou, yours };
}

/** Why `userId` can't take [start, end): another shift or time off. */
export async function shiftConflict(
  orgId: string,
  userId: string,
  shift: Pick<ScheduledShift, "shift_start" | "shift_end">,
  givingAway: number[],
): Promise<ShiftRequestFailure | null> {
  const start = new Date(shift.shift_start);
  const end = new Date(shift.shift_end);
  const overlapping = await dbGetOverlappingScheduledShifts(
    orgId,
    userId,
    start,
    end,
    givingAway,
  );
  if (overlapping.length > 0) {
    return fail(
      "schedule_conflict",
      "They're already scheduled for another shift at that time.",
    );
  }
  const days = shiftCalendarDays(start, end);
  const timeOff = await dbGetApprovedTimeOffForPeriod(
    userId,
    orgId,
    days.start,
    days.end,
  );
  if (timeOff.length > 0) {
    return fail(
      "time_off_conflict",
      `They have approved time off on ${formatTimeOffDates(timeOff[0])}.`,
    );
  }
  return null;
}

/** Checks both directions of a trade; null when everyone is free. */
async function tradeConflict(
  orgId: string,
  parties: { giver: string; taker: string },
  shift: ScheduledShift,
  swapShift: ScheduledShift | null,
): Promise<ShiftRequestFailure | null> {
  const takerConflict = await shiftConflict(
    orgId,
    parties.taker,
    shift,
    swapShift ? [swapShift.id] : [],
  );
  if (takerConflict) return takerConflict;
  return swapShift
    ? await shiftConflict(orgId, parties.giver, swapShift, [shift.id])
    : null;
}

const hasStarted = (shift: Pick<ScheduledShift, "shift_start">, now: Date) =>
  new Date(shift.shift_start).getTime() <= now.getTime();

export type CreateShiftRequestInput = {
  type: ShiftRequestType;
  /** The shift changing hands: yours (offer/swap) or a coworker's (pickup). */
  shiftId: number;
  /** For a swap: the coworker's shift you'd take in return. */
  swapShiftId?: number | null;
  /** For an offer: only this coworker may claim it. */
  targetUserId?: string | null;
  note?: string | null;
};

/** Posts an offer, or asks a coworker for a pickup or swap. */
export async function createShiftRequest(
  actor: ShiftRequestActor,
  input: CreateShiftRequestInput,
  now: Date = new Date(),
): Promise<ShiftRequestOutcome<ShiftRequest>> {
  const note = input.note?.trim() || null;
  if (note && note.length > MAX_SHIFT_REQUEST_NOTE_LENGTH) {
    return fail("invalid_input", "Note is too long (500 characters at most).");
  }
  if (input.type === "swap" && !input.swapShiftId) {
    return fail("invalid_input", "A swap needs the coworker's shift to trade.");
  }
  if (input.type !== "swap" && input.swapShiftId) {
    return fail("invalid_input", "Only a swap trades a second shift.");
  }
  if (input.type !== "offer" && input.targetUserId) {
    return fail("invalid_input", "Only an offer can name who may claim it.");
  }

  const shift = await dbGetScheduledShiftById(input.shiftId, actor.orgId);
  if (!shift) return fail("not_found", "That shift wasn't found.");
  if (hasStarted(shift, now)) {
    return fail("shift_started", "That shift has already started.");
  }

  const ownShift = shift.user_id === actor.userId;
  if (input.type === "pickup" && ownShift) {
    return fail("own_shift", "That's already your shift.");
  }
  if (input.type !== "pickup" && !ownShift) {
    return fail("forbidden", "You can only offer or swap your own shifts.");
  }

  let swapShift: ScheduledShift | null = null;
  if (input.type === "swap") {
    swapShift =
      (await dbGetScheduledShiftById(
        input.swapShiftId as number,
        actor.orgId,
      )) ?? null;
    if (!swapShift) {
      return fail("not_found", "The shift to swap for wasn't found.");
    }
    if (swapShift.user_id === actor.userId) {
      return fail("own_shift", "Pick a coworker's shift to swap for.");
    }
    if (hasStarted(swapShift, now)) {
      return fail(
        "shift_started",
        "The shift to swap for has already started.",
      );
    }
  }

  const targetUserId =
    input.type === "offer"
      ? input.targetUserId || null
      : input.type === "pickup"
        ? shift.user_id
        : (swapShift as ScheduledShift).user_id;
  if (targetUserId === actor.userId) {
    return fail("own_shift", "You can't offer a shift to yourself.");
  }
  // For a pickup or swap the taker is known now, so check they are free.
  const claimedBy =
    input.type === "offer"
      ? null
      : input.type === "pickup"
        ? actor.userId
        : targetUserId;
  if (claimedBy) {
    const conflict = await tradeConflict(
      actor.orgId,
      { giver: shift.user_id, taker: claimedBy },
      shift,
      swapShift,
    );
    if (conflict) return conflict;
  }

  const created = await dbCreateShiftRequest({
    orgId: actor.orgId,
    type: input.type,
    shiftId: shift.id,
    swapShiftId: swapShift?.id ?? null,
    requestedBy: actor.userId,
    targetUserId,
    claimedBy,
    note,
  });
  if (!created) {
    return fail(
      "already_requested",
      "That shift is already in an open swap or pickup request.",
    );
  }
  return { ok: true, value: created };
}

/** A live request plus its shifts, or why it can't be acted on. */
async function loadRequest(
  actor: ShiftRequestActor,
  id: number,
): Promise<ShiftRequestOutcome<ShiftRequestDetail>> {
  const request = await dbGetShiftRequest(id, actor.orgId);
  if (!request) return fail("not_found", `Shift request ${id} wasn't found.`);
  return { ok: true, value: request };
}

async function loadShifts(request: ShiftRequest, orgId: string) {
  const shift = await dbGetScheduledShiftById(request.shift_id, orgId);
  const swapShift = request.swap_shift_id
    ? ((await dbGetScheduledShiftById(request.swap_shift_id, orgId)) ?? null)
    : null;
  return { shift, swapShift };
}

/**
 * Claims an open offer, or accepts a pickup or swap addressed to you. The
 * request then waits for an admin's approval.
 */
export async function claimShiftRequest(
  actor: ShiftRequestActor,
  id: number,
  now: Date = new Date(),
): Promise<ShiftRequestOutcome<ShiftRequest>> {
  const loaded = await loadRequest(actor, id);
  if (!loaded.ok) return loaded;
  const request = loaded.value;
  if (request.status !== "open") {
    return fail(
      "not_open",
      `Shift request ${id} is ${SHIFT_REQUEST_STATUS_LABELS[request.status].toLowerCase()}, not open.`,
    );
  }
  if (
    request.request_type === "offer" &&
    request.requested_by === actor.userId
  ) {
    return fail("own_shift", "You can't claim your own shift.");
  }
  if (!canClaimShiftRequest(request, actor.userId)) {
    return fail(
      "forbidden",
      request.request_type === "offer"
        ? "This shift was offered to someone else."
        : "Only the coworker this request was sent to can accept it.",
    );
  }
  const { shift, swapShift } = await loadShifts(request, actor.orgId);
  if (!shift || (request.swap_shift_id && !swapShift)) {
    return fail("not_found", "The shift in this request no longer exists.");
  }
  if (hasStarted(shift, now) || (swapShift && hasStarted(swapShift, now))) {
    return fail("shift_started", "The shift has already started.");
  }
  const parties = shiftRequestParties(request);
  const taker = request.request_type === "offer" ? actor.userId : parties.taker;
  const conflict = await tradeConflict(
    actor.orgId,
    { giver: parties.giver, taker: taker as string },
    shift,
    swapShift,
  );
  if (conflict) return conflict;

  const claimed = await dbClaimShiftRequest(
    id,
    actor.orgId,
    request.request_type === "offer" ? actor.userId : null,
  );
  if (!claimed) {
    return fail("not_open", `Shift request ${id} is no longer open.`);
  }
  return { ok: true, value: claimed };
}

/**
 * Withdraws a live request (the member who made it, or an admin), or
 * declines a pickup or swap addressed to you.
 */
export async function cancelShiftRequest(
  actor: ShiftRequestActor,
  id: number,
): Promise<ShiftRequestOutcome<ShiftRequest>> {
  const loaded = await loadRequest(actor, id);
  if (!loaded.ok) return loaded;
  const request = loaded.value;
  if (request.status !== "open" && request.status !== "pending_approval") {
    return fail(
      "not_open",
      `Shift request ${id} is already ${SHIFT_REQUEST_STATUS_LABELS[request.status].toLowerCase()}.`,
    );
  }
  if (!canCancelShiftRequest(request, actor.userId, actor.isAdmin)) {
    return fail(
      "forbidden",
      "Only the member who made this request, the coworker it was sent to (while it's open), or an admin can cancel it.",
    );
  }
  const cancelled = await dbCancelShiftRequest(id, actor.orgId, actor.userId);
  if (!cancelled) {
    return fail("not_open", `Shift request ${id} was already closed.`);
  }
  return { ok: true, value: cancelled };
}

export type ApprovedShiftRequest = {
  request: ShiftRequest;
  /** The shift(s) as they are now, with their new owners. */
  shifts: ScheduledShift[];
  /** The same shift(s) before the trade, with their old owners. */
  previous: ScheduledShift[];
  /** Other live requests on these shifts, cancelled by the approval. */
  superseded: ShiftRequest[];
};

/**
 * Approves (moving the shift(s) in the schedule) or denies a request that
 * is waiting for approval. Admins only.
 */
export async function reviewShiftRequest(
  actor: ShiftRequestActor,
  id: number,
  decision: "approved" | "denied",
  reviewNote?: string | null,
  now: Date = new Date(),
): Promise<
  | { ok: true; decision: "approved"; value: ApprovedShiftRequest }
  | { ok: true; decision: "denied"; value: ShiftRequest }
  | ShiftRequestFailure
> {
  if (!actor.isAdmin) {
    return fail(
      "forbidden",
      "Only organization admins (org:admin) can approve or deny shift requests.",
    );
  }
  const note = reviewNote?.trim() || null;
  if (note && note.length > MAX_SHIFT_REQUEST_NOTE_LENGTH) {
    return fail("invalid_input", "Note is too long (500 characters at most).");
  }
  const loaded = await loadRequest(actor, id);
  if (!loaded.ok) return loaded;
  const request = loaded.value;
  if (request.status !== "pending_approval") {
    return fail(
      "not_pending",
      `Shift request ${id} is ${SHIFT_REQUEST_STATUS_LABELS[request.status].toLowerCase()}, not waiting for approval.`,
    );
  }

  if (decision === "denied") {
    const denied = await dbDenyShiftRequest(
      id,
      actor.orgId,
      actor.userId,
      note,
    );
    if (!denied) {
      return fail("not_pending", `Shift request ${id} was already reviewed.`);
    }
    return { ok: true, decision, value: denied };
  }

  const { shift, swapShift } = await loadShifts(request, actor.orgId);
  if (!shift || (request.swap_shift_id && !swapShift)) {
    return fail("not_found", "The shift in this request no longer exists.");
  }
  if (hasStarted(shift, now) || (swapShift && hasStarted(swapShift, now))) {
    return fail("shift_started", "The shift has already started.");
  }
  const parties = shiftRequestParties(request);
  const taker = parties.taker as string;
  const conflict = await tradeConflict(
    actor.orgId,
    { giver: parties.giver, taker },
    shift,
    swapShift,
  );
  if (conflict) return conflict;

  const approved = await dbApproveShiftRequest(
    id,
    actor.orgId,
    actor.userId,
    note,
  );
  if (!approved) {
    return fail(
      "shift_changed",
      "The shift changed hands or the request was reviewed while you were looking. Check the schedule and try again.",
    );
  }
  return {
    ok: true,
    decision,
    value: {
      ...approved,
      previous: swapShift ? [shift, swapShift] : [shift],
    },
  };
}
