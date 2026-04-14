import { startOfDay, subDays } from 'date-fns'
import { NextResponse } from 'next/server'
import { sendWeeklyReports } from '@/lib/reports'

export async function GET(request: Request) {
	const authHeader = request.headers.get('authorization')

	// Protect route strictly with CRON_SECRET from Vercel
	if (process.env.CRON_SECRET) {
		if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
		}
	} else {
		// If running without CRON_SECRET yet, just warn but allow for demo/testing
		console.warn('CRON_SECRET is not defined. Route is insecure.')
	}

	// Calculate the reporting period for the run.
	// The schedule is "0 6 1,8,16,24 * *".
	// This means if it runs on the 8th, it should ideally process 1st to 7th.
	// If it runs on 16th, process 8th to 15th.

	const today = new Date()
	const dayOfMonth = today.getDate()

	let startDaysToSubtract = 7
	// If it's the 1st of the month, we need to report from the 24th of the previous month.
	// We can just rely on subDays dynamically, or be precise.
	if (dayOfMonth === 1) {
		// 24th to end of month could be 7, 8, or 6 days depending on the month
		// Find the 24th of the previous month
		const prevDateMonth = new Date()
		prevDateMonth.setMonth(prevDateMonth.getMonth() - 1)
		prevDateMonth.setDate(24)

		// Calculate difference
		const diffTime = Math.abs(today.getTime() - prevDateMonth.getTime())
		startDaysToSubtract = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
	} else if (dayOfMonth === 8) {
		startDaysToSubtract = 7 // 1st to 7th
	} else if (dayOfMonth === 16) {
		startDaysToSubtract = 8 // 8th to 15th
	} else if (dayOfMonth === 24) {
		startDaysToSubtract = 8 // 16th to 23rd
	} else {
		// Default fallback if fired manually via test endpoint
		startDaysToSubtract = 7
	}

	const startDate = startOfDay(subDays(today, startDaysToSubtract))
	const endDate = today

	try {
		await sendWeeklyReports(startDate, endDate)
		return NextResponse.json({
			success: true,
			period: { from: startDate, to: endDate },
		})
	} catch (error) {
		console.error('Cron failed:', error)
		return NextResponse.json(
			{ error: 'Failed to send reports' },
			{ status: 500 },
		)
	}
}
