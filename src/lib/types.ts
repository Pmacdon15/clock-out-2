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

export type ReportingSettingsData = {
	org_id: string
	report_frequency: string
	report_day: string | null
	report_interval: number
	updated_at?: Date
}

export type OrgSettingsData = {
	org_id: string
	updated_at?: Date
	reporting?: ReportingSettingsData
}

export type TimeEntryAction =
	| { type: 'ADD'; payload: TimeEntry }
	| { type: 'REMOVE'; payload: number }
	| { type: 'UPDATE'; payload: { id: number } & Partial<TimeEntry> }

export interface ClerkBillingFeature {
	slug: string
}

export interface ClerkBillingPlan {
	features?: ClerkBillingFeature[]
}

export interface ClerkBillingSubscriptionItem {
	plan?: ClerkBillingPlan
}

export interface ClerkBillingSubscription {
	subscriptionItems: ClerkBillingSubscriptionItem[]
}

export interface ClerkWebhookEvent {
	type: string
	data: {
		plan: {
			slug: string
		}
		payer?: {
			organization_id?: string
		}
	}
}

export interface RawClerkMember {
	publicUserData?: {
		userId?: string
		firstName?: string | null
		lastName?: string | null
		identifier?: string
	}
}
