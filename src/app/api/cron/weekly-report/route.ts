import { clerkClient } from '@clerk/nextjs/server'
import { format, getWeek, startOfDay, subDays, subMonths } from 'date-fns'
import { NextResponse } from 'next/server'
import { dbGetOrgSettings } from '@/lib/db'
import { sendWeeklyReports } from '@/lib/reports'

export async function GET(request: Request) {
	const authHeader = request.headers.get('authorization')

	if (process.env.CRON_SECRET) {
		if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
		}
	}

	const today = new Date()
	const dayOfMonth = today.getDate()
	const weekday = format(today, 'EEEE') // e.g., 'Monday'

	const client = await clerkClient()
	const orgsResult = await client.organizations.getOrganizationList({
		limit: 100,
	})
	const allOrgs = orgsResult.data

	console.log(
		`[Cron] Processing ${allOrgs.length} organizations on ${format(today, 'yyyy-MM-dd')} (${weekday})`,
	)

	const results = []

	for (const org of allOrgs) {
		const orgId = org.id

		// Check for reporting feature in subscriptions
		let hasReportingFeature = false
		try {
			const subscription =
				await client.billing.getOrganizationBillingSubscription(orgId)
			hasReportingFeature = subscription.subscriptionItems.some(
				(item: any) =>
					item.plan?.features?.some(
						(f: any) => f.slug === 'reporting',
					),
			)
		} catch (error) {
			// If no billing or error, assume no feature
			console.log(
				`[Cron] No billing/subscription for ${org.name} (${orgId})`,
			)
		}

		if (!hasReportingFeature) continue

		const settings = await dbGetOrgSettings(orgId)
		const frequency = settings?.report_frequency || 'weekly'
		const settingDay = settings?.report_day
		const interval = settings?.report_interval || 1

		let shouldSend = false
		let startDate: Date | null = null
		const endDate: Date = startOfDay(today)

		if (frequency === 'weekly') {
			// Fixed dates: 1st, 8th, 16th, 24th
			if (dayOfMonth === 1) {
				shouldSend = true
				// Prev month 24th to end of month
				const prevMonth = subMonths(today, 1)
				startDate = new Date(
					prevMonth.getFullYear(),
					prevMonth.getMonth(),
					24,
				)
			} else if (dayOfMonth === 8) {
				shouldSend = true
				startDate = new Date(today.getFullYear(), today.getMonth(), 1)
			} else if (dayOfMonth === 16) {
				shouldSend = true
				startDate = new Date(today.getFullYear(), today.getMonth(), 8)
			} else if (dayOfMonth === 24) {
				shouldSend = true
				startDate = new Date(today.getFullYear(), today.getMonth(), 16)
			}
		} else if (frequency === 'twice-monthly') {
			// Pay period: 1st and 16th
			if (dayOfMonth === 16) {
				shouldSend = true
				startDate = new Date(today.getFullYear(), today.getMonth(), 1)
			} else if (dayOfMonth === 1) {
				shouldSend = true
				// Prev month 16th to end of month
				const prevMonth = subMonths(today, 1)
				startDate = new Date(
					prevMonth.getFullYear(),
					prevMonth.getMonth(),
					16,
				)
			}
		} else if (frequency === 'custom') {
			// Weekday-based
			if (weekday === settingDay) {
				if (interval === 1) {
					shouldSend = true
					startDate = subDays(today, 7)
				} else if (interval === 2) {
					// Every 2nd Tuesday kinda thing
					// Use week number to determine parity (even weeks)
					if (getWeek(today) % 2 === 0) {
						shouldSend = true
						startDate = subDays(today, 14)
					}
				}
			}
		}

		if (shouldSend && startDate) {
			console.log(
				`[Cron] Sending ${frequency} report for ${org.name} (${orgId})`,
			)
			try {
				await sendWeeklyReports(startOfDay(startDate), endDate, orgId)
				results.push({
					org: org.name,
					status: 'sent',
					frequency,
					period: { from: startDate, to: endDate },
				})
			} catch (error) {
				console.error(`[Cron] Failed to send for ${org.name}:`, error)
				results.push({ org: org.name, status: 'error', error })
			}
		}
	}

	return NextResponse.json({
		success: true,
		processedCount: results.length,
		processed: results,
		date: today.toISOString(),
	})
}
