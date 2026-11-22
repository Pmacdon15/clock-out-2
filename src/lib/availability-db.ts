import { sql } from "./db";
import type { AvailabilityKind, AvailabilityWindow } from "./types";

/*
 * Members' weekly availability (`member_availability` in schema.sql). Every
 * query is scoped to one organization.
 */

let availabilityTableReady = false;

/**
 * Production databases that predate `member_availability` don't have it, so
 * create it on first use (same approach as the other optional tables). Runs
 * once per server instance; a failure is not cached.
 */
export async function ensureAvailabilityTable(): Promise<void> {
  if (availabilityTableReady) return;
  await sql`
		CREATE TABLE IF NOT EXISTS member_availability (
			id SERIAL PRIMARY KEY,
			org_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			kind TEXT NOT NULL CHECK (kind IN ('available', 'unavailable')),
			weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
			start_minute SMALLINT NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
			end_minute SMALLINT NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
			timezone TEXT NOT NULL,
			note TEXT,
			CHECK (start_minute <> end_minute),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`;
  await sql`
		CREATE INDEX IF NOT EXISTS idx_member_availability_org_user
			ON member_availability (org_id, user_id)
	`;
  availabilityTableReady = true;
}

/** Test-only: forget that the table check ran. */
export function resetAvailabilityTableCheck() {
  availabilityTableReady = false;
}

/** The org's windows (or one member's, given `userId`), by day and time. */
export async function dbListAvailability(orgId: string, userId: string | null) {
  await ensureAvailabilityTable();
  const rows = await sql`
		SELECT * FROM member_availability
		WHERE org_id = ${orgId}
		AND (${userId}::TEXT IS NULL OR user_id = ${userId})
		ORDER BY user_id ASC, weekday ASC, start_minute ASC, id ASC
	`;
  return rows as unknown as AvailabilityWindow[];
}

export type NewAvailabilityRows = {
  orgId: string;
  userId: string;
  kind: AvailabilityKind;
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  timezone: string;
  note: string | null;
  /** Most windows the member may have once these are added. */
  max: number;
};

/**
 * Adds one window per weekday, unless that would take the member past
 * `max` windows (returns undefined then, and adds nothing). The advisory
 * lock stops two saves sent together from both slipping under the limit.
 */
export async function dbAddAvailability(input: NewAvailabilityRows) {
  await ensureAvailabilityTable();
  const [, inserted] = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.orgId}:${input.userId}:availability`}::text, 0))`,
    sql`
		INSERT INTO member_availability
			(org_id, user_id, kind, weekday, start_minute, end_minute, timezone, note)
		SELECT ${input.orgId}, ${input.userId}, ${input.kind}, d,
			${input.startMinute}, ${input.endMinute}, ${input.timezone}, ${input.note}
		FROM unnest(${input.weekdays}::SMALLINT[]) AS d
		WHERE (
			SELECT COUNT(*) FROM member_availability
			WHERE org_id = ${input.orgId} AND user_id = ${input.userId}
		) + ${input.weekdays.length} <= ${input.max}
		RETURNING *
	`,
  ]);
  const rows = inserted as unknown as AvailabilityWindow[];
  return rows.length > 0 ? rows : undefined;
}

/**
 * Removes a window in the org; only the member's own unless `userId` is
 * null (an admin). Undefined if there was no such window.
 */
export async function dbDeleteAvailability(
  id: number,
  orgId: string,
  userId: string | null,
) {
  await ensureAvailabilityTable();
  const [deleted] = await sql`
		DELETE FROM member_availability
		WHERE id = ${id} AND org_id = ${orgId}
		AND (${userId}::TEXT IS NULL OR user_id = ${userId})
		RETURNING *
	`;
  return deleted as unknown as AvailabilityWindow | undefined;
}
