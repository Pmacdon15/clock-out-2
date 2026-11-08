import { ensureScheduledShiftsTable, sql } from "./db";
import type {
  ScheduledShift,
  ShiftRequest,
  ShiftRequestDetail,
  ShiftRequestStatus,
  ShiftRequestType,
} from "./types";

/*
 * Shift swap and pickup requests (`shift_requests` in schema.sql). Every
 * query is scoped to one organization; state changes only apply from the
 * status they expect, so two people acting at once can't both win.
 */

/** Statuses in which a request still holds its shift(s). */
export const ACTIVE_SHIFT_REQUEST_STATUSES: ShiftRequestStatus[] = [
  "open",
  "pending_approval",
];

let shiftRequestsTableReady: Promise<void> | null = null;

/**
 * Production databases that predate `shift_requests` in schema.sql don't
 * have it, so create it on first use (same approach as the other optional
 * tables). Runs once per server instance; a failure is not cached.
 */
export function ensureShiftRequestsTable(): Promise<void> {
  shiftRequestsTableReady ??= (async () => {
    await ensureScheduledShiftsTable();
    await sql`
		CREATE TABLE IF NOT EXISTS shift_requests (
			id SERIAL PRIMARY KEY,
			org_id TEXT NOT NULL,
			request_type TEXT NOT NULL CHECK (request_type IN ('offer', 'pickup', 'swap')),
			shift_id INTEGER NOT NULL REFERENCES scheduled_shifts(id) ON DELETE CASCADE,
			swap_shift_id INTEGER REFERENCES scheduled_shifts(id) ON DELETE CASCADE,
			requested_by TEXT NOT NULL,
			target_user_id TEXT,
			claimed_by TEXT,
			note TEXT,
			status TEXT NOT NULL DEFAULT 'open'
				CHECK (status IN ('open', 'pending_approval', 'approved', 'denied', 'cancelled')),
			claimed_at TIMESTAMP WITH TIME ZONE,
			reviewed_by TEXT,
			reviewed_at TIMESTAMP WITH TIME ZONE,
			review_note TEXT,
			cancelled_by TEXT,
			CHECK ((request_type = 'swap') = (swap_shift_id IS NOT NULL)),
			CHECK (swap_shift_id IS NULL OR swap_shift_id <> shift_id),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`;
    await sql`
		CREATE INDEX IF NOT EXISTS idx_shift_requests_org_status
			ON shift_requests (org_id, status)
	`;
    await sql`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_requests_one_active
			ON shift_requests (shift_id)
			WHERE status IN ('open', 'pending_approval')
	`;
  })().catch((error) => {
    shiftRequestsTableReady = null;
    throw error;
  });
  return shiftRequestsTableReady;
}

/** Test-only: forget that the table check ran. */
export function resetShiftRequestsTableCheck() {
  shiftRequestsTableReady = null;
}

/**
 * Requests with one of `statuses` whose shift hasn't ended by `since`,
 * soonest shift first, with the times and owners of the shift(s).
 */
export async function dbListShiftRequests(
  orgId: string,
  statuses: ShiftRequestStatus[],
  since: Date,
) {
  await ensureShiftRequestsTable();
  const rows = await sql`
		SELECT r.*, s.shift_start, s.shift_end, s.user_id AS shift_owner,
			s.note AS shift_note, w.shift_start AS swap_shift_start,
			w.shift_end AS swap_shift_end, w.user_id AS swap_shift_owner
		FROM shift_requests r
		JOIN scheduled_shifts s ON s.id = r.shift_id
		LEFT JOIN scheduled_shifts w ON w.id = r.swap_shift_id
		WHERE r.org_id = ${orgId}
		AND r.status = ANY(${statuses})
		AND s.shift_end > ${since}
		ORDER BY s.shift_start ASC, r.id ASC
	`;
  return rows as unknown as ShiftRequestDetail[];
}

/** One request in the org with its shift details, or undefined. */
export async function dbGetShiftRequest(id: number, orgId: string) {
  await ensureShiftRequestsTable();
  const [row] = await sql`
		SELECT r.*, s.shift_start, s.shift_end, s.user_id AS shift_owner,
			s.note AS shift_note, w.shift_start AS swap_shift_start,
			w.shift_end AS swap_shift_end, w.user_id AS swap_shift_owner
		FROM shift_requests r
		JOIN scheduled_shifts s ON s.id = r.shift_id
		LEFT JOIN scheduled_shifts w ON w.id = r.swap_shift_id
		WHERE r.id = ${id} AND r.org_id = ${orgId}
	`;
  return row as unknown as ShiftRequestDetail | undefined;
}

export type NewShiftRequest = {
  orgId: string;
  type: ShiftRequestType;
  shiftId: number;
  swapShiftId: number | null;
  requestedBy: string;
  targetUserId: string | null;
  claimedBy: string | null;
  note: string | null;
};

/**
 * Files an open request, unless either shift is already in an open or
 * pending request (returns undefined then). The advisory lock stops two
 * requests for the same shift sent together from both getting in.
 */
export async function dbCreateShiftRequest(input: NewShiftRequest) {
  await ensureShiftRequestsTable();
  const swapId = input.swapShiftId;
  const [, inserted] = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.orgId}:shift-requests`}::text, 0))`,
    sql`
		INSERT INTO shift_requests
			(org_id, request_type, shift_id, swap_shift_id, requested_by,
			target_user_id, claimed_by, note, status)
		SELECT ${input.orgId}, ${input.type}, ${input.shiftId}, ${swapId}::INTEGER,
			${input.requestedBy}, ${input.targetUserId}, ${input.claimedBy},
			${input.note}, 'open'
		WHERE NOT EXISTS (
			SELECT 1 FROM shift_requests
			WHERE org_id = ${input.orgId}
			AND status IN ('open', 'pending_approval')
			AND (shift_id IN (${input.shiftId}, ${swapId}::INTEGER)
				OR swap_shift_id IN (${input.shiftId}, ${swapId}::INTEGER))
		)
		RETURNING *
	`,
  ]);
  return inserted[0] as unknown as ShiftRequest | undefined;
}

/**
 * Moves an open request to pending approval. For an offer, `claimedBy` is
 * the coworker taking it; for a pickup or swap the taker is already set and
 * `claimedBy` is null. Undefined if it wasn't open any more.
 */
export async function dbClaimShiftRequest(
  id: number,
  orgId: string,
  claimedBy: string | null,
) {
  await ensureShiftRequestsTable();
  const [updated] = await sql`
		UPDATE shift_requests
		SET status = 'pending_approval',
			claimed_by = COALESCE(${claimedBy}::TEXT, claimed_by),
			claimed_at = NOW(), updated_at = NOW()
		WHERE id = ${id} AND org_id = ${orgId} AND status = 'open'
		AND COALESCE(${claimedBy}::TEXT, claimed_by) IS NOT NULL
		RETURNING *
	`;
  return updated as unknown as ShiftRequest | undefined;
}

/** Cancels (or declines) a live request. Undefined if it wasn't live. */
export async function dbCancelShiftRequest(
  id: number,
  orgId: string,
  cancelledBy: string,
) {
  await ensureShiftRequestsTable();
  const [updated] = await sql`
		UPDATE shift_requests
		SET status = 'cancelled', cancelled_by = ${cancelledBy}, updated_at = NOW()
		WHERE id = ${id} AND org_id = ${orgId}
		AND status IN ('open', 'pending_approval')
		RETURNING *
	`;
  return updated as unknown as ShiftRequest | undefined;
}

/** Denies a request waiting for approval. Undefined if it wasn't waiting. */
export async function dbDenyShiftRequest(
  id: number,
  orgId: string,
  reviewerId: string,
  reviewNote: string | null,
) {
  await ensureShiftRequestsTable();
  const [updated] = await sql`
		UPDATE shift_requests
		SET status = 'denied', reviewed_by = ${reviewerId}, reviewed_at = NOW(),
			review_note = ${reviewNote}, updated_at = NOW()
		WHERE id = ${id} AND org_id = ${orgId} AND status = 'pending_approval'
		RETURNING *
	`;
  return updated as unknown as ShiftRequest | undefined;
}

type ShiftRow = Omit<ScheduledShift, "shift_start" | "shift_end"> & {
  shift_start: Date | string;
  shift_end: Date | string;
};

const toShift = (row: ShiftRow): ScheduledShift => ({
  ...row,
  shift_start: new Date(row.shift_start),
  shift_end: new Date(row.shift_end),
});

/**
 * Approves a request waiting for approval and, in the same statement, hands
 * `shift_id` to `claimed_by` (and, for a swap, `swap_shift_id` to
 * `requested_by`). Nothing changes, and undefined comes back, unless the
 * request is still waiting and each shift still belongs to the member giving
 * it up. Other live requests on the same shifts are cancelled.
 */
export async function dbApproveShiftRequest(
  id: number,
  orgId: string,
  reviewerId: string,
  reviewNote: string | null,
): Promise<
  | {
      request: ShiftRequest;
      shifts: ScheduledShift[];
      superseded: ShiftRequest[];
    }
  | undefined
> {
  await ensureShiftRequestsTable();
  const [approved, superseded] = await sql.transaction([
    sql`
		WITH req AS (
			UPDATE shift_requests r
			SET status = 'approved', reviewed_by = ${reviewerId},
				reviewed_at = NOW(), review_note = ${reviewNote}, updated_at = NOW()
			WHERE r.id = ${id} AND r.org_id = ${orgId}
			AND r.status = 'pending_approval' AND r.claimed_by IS NOT NULL
			AND EXISTS (
				SELECT 1 FROM scheduled_shifts s
				WHERE s.id = r.shift_id AND s.org_id = r.org_id
				AND s.user_id = (CASE WHEN r.request_type = 'pickup'
					THEN r.target_user_id ELSE r.requested_by END)
			)
			AND (r.swap_shift_id IS NULL OR EXISTS (
				SELECT 1 FROM scheduled_shifts s
				WHERE s.id = r.swap_shift_id AND s.org_id = r.org_id
				AND s.user_id = r.claimed_by
			))
			RETURNING r.*
		), moved AS (
			UPDATE scheduled_shifts s
			SET user_id = (CASE WHEN s.id = req.shift_id
				THEN req.claimed_by ELSE req.requested_by END),
				updated_at = NOW()
			FROM req
			WHERE s.org_id = req.org_id
			AND (s.id = req.shift_id OR s.id = req.swap_shift_id)
			RETURNING s.*
		)
		SELECT (SELECT row_to_json(req) FROM req) AS request,
			COALESCE((SELECT json_agg(m ORDER BY m.id) FROM moved m), '[]'::json) AS shifts
	`,
    sql`
		UPDATE shift_requests o
		SET status = 'cancelled', cancelled_by = ${reviewerId}, updated_at = NOW()
		FROM shift_requests a
		WHERE a.id = ${id} AND a.org_id = ${orgId}
		AND a.status = 'approved' AND a.reviewed_at = NOW()
		AND o.org_id = a.org_id AND o.id <> a.id
		AND o.status IN ('open', 'pending_approval')
		AND (o.shift_id IN (a.shift_id, a.swap_shift_id)
			OR o.swap_shift_id IN (a.shift_id, a.swap_shift_id))
		RETURNING o.*
	`,
  ]);
  const row = approved[0] as
    | { request: ShiftRequest | null; shifts: ShiftRow[] }
    | undefined;
  if (!row?.request) return undefined;
  return {
    request: row.request,
    shifts: row.shifts.map(toShift),
    superseded: superseded as unknown as ShiftRequest[],
  };
}

/**
 * The member's shifts in the org overlapping [start, end), leaving out
 * `excludeIds` (shifts they'd be giving away in the same trade).
 */
export async function dbGetOverlappingScheduledShifts(
  orgId: string,
  userId: string,
  start: Date,
  end: Date,
  excludeIds: number[],
) {
  await ensureShiftRequestsTable();
  const rows = await sql`
		SELECT * FROM scheduled_shifts
		WHERE org_id = ${orgId} AND user_id = ${userId}
		AND shift_start < ${end} AND shift_end > ${start}
		AND NOT (id = ANY(${excludeIds}::INTEGER[]))
		ORDER BY shift_start ASC
	`;
  return rows as unknown as ScheduledShift[];
}
