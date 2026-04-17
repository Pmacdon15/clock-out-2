import { neon } from '@neondatabase/serverless'
import { cacheLife, cacheTag } from 'next/cache'
import type { TimeEntry } from './types'

if (!process.env.DATABASE_URL) {
	throw new Error('DATABASE_URL is not defined')
}

export const sql = neon(process.env.DATABASE_URL)

export async function dbGetTimeEntries(userId: string, orgId: string) {
	'use cache'
	cacheTag(`time-entries-${userId}-${orgId}`)
	cacheLife('hours')

	const rows = await sql`
        SELECT * FROM time_entries 
        WHERE user_id = ${userId} AND org_id = ${orgId}
        ORDER BY clock_in DESC
    `
	return rows as unknown as TimeEntry[]
}

export async function dbCheckActiveEntry(userId: string, orgId: string) {
	const activeEntry = await sql`
        SELECT id FROM time_entries 
        WHERE user_id = ${userId} AND org_id = ${orgId} AND clock_out IS NULL
        LIMIT 1
    `
	return activeEntry
}

export async function dbClockIn(userId: string, orgId: string) {
	const [newEntry] = await sql`
        INSERT INTO time_entries (user_id, org_id, clock_in)
        VALUES (${userId}, ${orgId}, NOW())
        RETURNING *
    `
	return newEntry as unknown as TimeEntry
}

export async function dbClockOut(userId: string, orgId: string) {
	const [activeEntry] = await sql`
        UPDATE time_entries
        SET clock_out = NOW(), updated_at = NOW()
        WHERE user_id = ${userId} AND org_id = ${orgId} AND clock_out IS NULL
        RETURNING *
    `
	return activeEntry as unknown as TimeEntry | undefined
}

export async function dbDeleteTimeEntry(
	id: number,
	orgId: string,
	// isAdmin: boolean,
) {
	const [deleted] = await sql`
      DELETE FROM time_entries 
      WHERE id = ${id} AND org_id = ${orgId}     
      RETURNING *
    `
	return deleted as unknown as TimeEntry | undefined
}

export async function dbUpdateTimeEntry(
	id: number,
	clock_in: Date,
	clock_out: Date | null,
	orgId: string,
	isAdmin: boolean,
) {
	const [updated] = await sql`
      UPDATE time_entries
      SET clock_in = ${clock_in},
          clock_out = ${clock_out},
          updated_at = NOW()
      WHERE id = ${id} AND org_id = ${orgId}
      AND ${isAdmin}
      RETURNING *
    `
	return updated as unknown as TimeEntry | undefined
}

export async function dbGetTimeEntriesForPeriod(
	userId: string,
	orgId: string,
	startDate: Date,
	endDate: Date,
) {
	const rows = await sql`
        SELECT * FROM time_entries 
        WHERE user_id = ${userId} AND org_id = ${orgId}
        AND clock_in >= ${startDate} AND clock_in < ${endDate}
        ORDER BY clock_in ASC
    `
	return rows as unknown as TimeEntry[]
}

export async function dbGetOrgSettings(orgId: string) {
	const [settings] = await sql`
		SELECT * FROM org_settings WHERE org_id = ${orgId}
	`
	return settings as
		| {
				org_id: string
				report_frequency: string
				report_day: string | null
				report_interval: number
				updated_at: Date
		  }
		| undefined
}

export async function dbUpdateOrgSettings(
	orgId: string,
	frequency: string,
	day: string | null,
	interval: number,
) {
	const [updated] = await sql`
		INSERT INTO org_settings (org_id, report_frequency, report_day, report_interval, updated_at)
		VALUES (${orgId}, ${frequency}, ${day}, ${interval}, NOW())
		ON CONFLICT (org_id) 
		DO UPDATE SET 
            report_frequency = ${frequency}, 
            report_day = ${day}, 
            report_interval = ${interval}, 
            updated_at = NOW()
		RETURNING *
	`
	return updated
}

// export async function dbInitSchema() {
// 	await sql`
// 		CREATE TABLE IF NOT EXISTS org_settings (
// 			org_id TEXT PRIMARY KEY,
// 			report_frequency TEXT NOT NULL DEFAULT 'weekly',
// 			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
// 		);
// 	`
// }
