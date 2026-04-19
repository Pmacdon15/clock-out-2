import { clerkClient } from '@clerk/nextjs/server'
import { format } from 'date-fns'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import { render } from '@react-email/render'
import { WeeklyReportEmail } from '@/components/emails/WeeklyReportEmail'
import { dbGetTimeEntriesForPeriod } from './db'

const sesClient = new SESClient({
	region: process.env.AWS_REGION || 'us-east-1',
})

function formatDuration(ms: number) {
	const totalMinutes = Math.floor(ms / (1000 * 60))
	const hours = Math.floor(totalMinutes / 60)
	const minutes = totalMinutes % 60
	if (hours > 0) return `${hours}h ${minutes}m`
	return `${minutes}m`
}

export async function sendWeeklyReports(
	startDate: Date,
	endDate: Date,
	targetOrgId?: string,
) {
	const hasAwsCreds =
		process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
	if (!hasAwsCreds) {
		console.warn('AWS credentials are not defined. Skipping email sending.')
		return false
	}

	const client = await clerkClient()

	let allOrgs = []
	if (targetOrgId) {
		const org = await client.organizations.getOrganization({
			organizationId: targetOrgId,
		})
		allOrgs = [org]
	} else {
		// Fetch all organizations in the instance
		const orgsResult = await client.organizations.getOrganizationList({
			limit: 100,
		})
		allOrgs = orgsResult.data
	}

	console.log(`[Reports] Found ${allOrgs.length} organizations to process.`)

	// Process each organization
	for (const org of allOrgs) {
		const orgId = org.id

		// Check for reporting feature in subscriptions
		let hasReportingFeature = false
		try {
			// @ts-ignore - Clerk Billing is in Beta and types might not be fully updated yet
			const subscription = await client.billing.getOrganizationBillingSubscription(orgId)
			hasReportingFeature = subscription.subscriptionItems.some((item: any) =>
				item.plan?.features?.some((f: any) => f.slug === 'reporting'),
			)
		} catch (error) {
			// If no billing or error, assume no feature
			console.log(`[Reports] No billing/subscription for ${org.name} (${orgId})`)
		}

		if (!hasReportingFeature) {
			console.log(
				`[Reports] Organization ${org.name} (${orgId}) does not have the 'reporting' feature. Skipping reports.`,
			)
			continue
		}

		console.log(`[Reports] Processing Organization: ${org.name} (${orgId})`)

		// Get members of this org
		const membersData =
			await client.organizations.getOrganizationMembershipList({
				organizationId: orgId,
				limit: 100,
			})
		const members = membersData.data
		console.log(
			`[Reports] Found ${members.length} members in organization ${org.name}.`,
		)

		// Find admins to send emails to
		const adminEmails = members
			.filter((m) => {
				const isAdmin = m.role === 'org:admin'
				const hasEmail = !!m.publicUserData?.identifier
				return isAdmin && hasEmail
			})
			.map((m) => m.publicUserData?.identifier as string)

		console.log(`[Reports] Admin emails found:`, adminEmails)

		if (adminEmails.length === 0) {
			console.log(
				`[Reports] No admins found for organization ${org.name}. Skipping.`,
			)
			continue
		}

		// Generate report for each member, even non-admins
		for (const member of members) {
			const publicUserData = member.publicUserData
			const userId = publicUserData?.userId
			if (!userId) continue

			const userName = publicUserData.firstName
				? `${publicUserData.firstName} ${publicUserData.lastName || ''}`.trim()
				: publicUserData.identifier

			console.log(
				`[Reports] Fetching entries for member: ${userName} (${userId})`,
			)

			const entries = await dbGetTimeEntriesForPeriod(
				userId,
				orgId,
				startDate,
				endDate,
			)

			let totalMs = 0
			const dailyBreakdownMap = new Map<
				string,
				{
					date: string
					rawMs: number
					shifts: { start: string; end: string; duration: string }[]
				}
			>()

			for (const entry of entries) {
				if (!entry.clock_out) continue // Skip incomplete entries

				const inDate = new Date(entry.clock_in)
				const outDate = new Date(entry.clock_out)
				const durationMs = outDate.getTime() - inDate.getTime()

				totalMs += durationMs

				const dateKey = format(inDate, 'MMM d, yyyy')
				if (!dailyBreakdownMap.has(dateKey)) {
					dailyBreakdownMap.set(dateKey, {
						date: dateKey,
						rawMs: 0,
						shifts: [],
					})
				}

				const dayData = dailyBreakdownMap.get(dateKey)
				if (dayData) {
					dayData.rawMs += durationMs
					dayData.shifts.push({
						start: format(inDate, 'h:mm a'),
						end: format(outDate, 'h:mm a'),
						duration: formatDuration(durationMs),
					})
				}
			}

			console.log(
				`[Reports] Member ${userName} has ${entries.length} entries for this period.`,
			)

			// Convert breakdown map to array
			const breakdown = Array.from(dailyBreakdownMap.values())

			const totalHoursString = formatDuration(totalMs)

			// Generate Chart URL
			const chartConfig = {
				type: 'bar',
				data: {
					labels: breakdown.map((b) => b.date.split(',')[0]), // "Apr 5"
					datasets: [
						{
							label: 'Hours Logged',
							data: breakdown.map((b) =>
								parseFloat(
									(b.rawMs / (1000 * 60 * 60)).toFixed(2),
								),
							),
							backgroundColor: 'rgba(59, 130, 246, 0.7)',
						},
					],
				},
				options: {
					plugins: { legend: { display: false } },
					scales: {
						yAxes: [{ ticks: { beginAtZero: true, min: 0 } }], // v2
						y: { beginAtZero: true, min: 0 }, // v3
					},
				},
			}
			const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=500&h=300`

			// Render React Email
			const periodStartStr = format(startDate, 'MMM d, yyyy')
			const periodEndStr = format(endDate, 'MMM d, yyyy')

			// Map startDate to the 1-4 week indexing used in ViewHours UI
			const dayOfMonth = startDate.getDate()
			let weekIndex = 1
			if (dayOfMonth >= 22) weekIndex = 4
			else if (dayOfMonth >= 15) weekIndex = 3
			else if (dayOfMonth >= 8) weekIndex = 2

			if (entries.length > 0) {
				console.log(
					`[Reports] Sending email for ${userName} to admins: ${adminEmails.join(', ')}`,
				)
				try {
					const emailHtml = await render(
						WeeklyReportEmail({
							userName,
							totalHours: totalHoursString,
							periodStart: periodStartStr,
							periodEnd: periodEndStr,
							chartUrl,
							dashboardUrl:
								process.env.NEXT_PUBLIC_APP_URL ||
								'https://clockout.patmac.ca',
							userId: userId,
							week: weekIndex.toString(),
							month: startDate.getMonth().toString(),
							year: startDate.getFullYear().toString(),
							breakdown: breakdown,
						}),
					)

					const command = new SendEmailCommand({
						Destination: {
							ToAddresses: adminEmails,
						},
						Message: {
							Body: {
								Html: {
									Charset: 'UTF-8',
									Data: emailHtml,
								},
							},
							Subject: {
								Charset: 'UTF-8',
								Data: `Weekly Hours Report for ${userName}`,
							},
						},
						Source:
							process.env.SES_FROM_EMAIL ||
							'Clock Out <no-reply@clockout.patmac.ca>',
					})

					const data = await sesClient.send(command)
					console.log(`[Reports] SES Success for ${userName}:`, data)
				} catch (error) {
					console.error(
						`[Reports] Catch Error sending email for ${userName}:`,
						error,
					)
				}
			} else {
				console.log(
					`[Reports] No completed entries for ${userName}. Skipping email.`,
				)
			}
		}
	}

	return true
}
