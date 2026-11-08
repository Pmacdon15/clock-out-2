import type {
  ShiftRequest,
  ShiftRequestStatus,
  ShiftRequestType,
} from "./types";

/*
 * Pure shift-request helpers with no database or server-only imports, so the
 * client-side Schedule page component can use them. Re-exported from
 * ./shift-requests for server code.
 */

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
