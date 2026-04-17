export type TimeEntry = {
	id: number
	user_id: string
	org_id: string
	clock_in: Date
	clock_out: Date | null
	created_at: Date
	updated_at: Date
}

export type SerializableResult<T, E> =
	| { value: T; ok: true }
	| { error: E; ok: false }

export type OrgSettingsData = {
	org_id: string
	report_frequency: string
	updated_at?: Date
	report_day?: string | null
	report_interval?: number | null
}
