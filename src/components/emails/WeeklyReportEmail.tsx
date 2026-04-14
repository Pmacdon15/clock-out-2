import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Img,
	Link,
	Preview,
	Section,
	Text,
} from '@react-email/components'
import { Tailwind } from '@react-email/tailwind'

interface WeeklyReportEmailProps {
	userName: string
	totalHours: string
	periodStart: string
	periodEnd: string
	chartUrl: string
	dashboardUrl: string
	userId?: string
	week?: string
	month?: string
	year?: string
	breakdown: {
		date: string
		shifts: { start: string; end: string; duration: string }[]
	}[]
}

export const WeeklyReportEmail = ({
	userName = 'User',
	totalHours = '0h 0m',
	periodStart = 'Jan 1, 2024',
	periodEnd = 'Jan 7, 2024',
	chartUrl = '',
	dashboardUrl = 'https://clockout.patmac.ca',
	userId = '',
	week = '',
	month = '',
	year = '',
	breakdown = [],
}: WeeklyReportEmailProps) => {
	let linkWithParams = `${dashboardUrl}/?defaultTab=view&timeframe=week`
	if (userId) linkWithParams += `&userId=${userId}`
	if (week) linkWithParams += `&week=${week}`
	if (month) linkWithParams += `&month=${month}`
	if (year) linkWithParams += `&year=${year}`

	return (
		<Html>
			<Head />
			<Preview>Weekly Hours Report for {userName}</Preview>
			<Tailwind>
				<Body className="mx-auto my-auto bg-gray-50 px-2 font-sans">
					<Container className="mx-auto my-[40px] max-w-[465px] rounded border border-gray-200 border-solid bg-white p-[20px]">
						<Heading className="mx-0 my-[30px] p-0 text-center font-normal text-[24px] text-black">
							Time Report
						</Heading>
						<Text className="text-[14px] text-black leading-[24px]">
							Hello Admin,
						</Text>
						<Text className="text-[14px] text-black leading-[24px]">
							Here is the weekly hours report for{' '}
							<strong>{userName}</strong> from {periodStart} to{' '}
							{periodEnd}.
						</Text>
						<Text className="text-[14px] text-black leading-[24px]">
							<strong>Total Hours Logged:</strong> {totalHours}
						</Text>

						{chartUrl && (
							<Section className="my-[20px]">
								<Img
									alt="Hours Chart"
									className="w-full rounded-md border border-gray-200"
									src={chartUrl}
								/>
							</Section>
						)}

						<Section className="mt-[32px]">
							<Heading className="m-0 mb-4 font-bold text-[18px] text-black">
								Detailed Breakdown
							</Heading>
							{breakdown.length === 0 ? (
								<Text className="text-[14px] text-gray-500">
									No hours logged in this period.
								</Text>
							) : (
								breakdown.map((day) => (
									<div
										key={day.date}
										style={{ marginBottom: '24px' }}
									>
										<Text className="m-0 mb-2 border-gray-200 border-b pb-1 font-bold text-[14px] text-black">
											{day.date}
										</Text>
										{day.shifts.map((shift, idx) => (
											<div
												key={idx}
												style={{
													display: 'flex',
													justifyContent:
														'space-between',
													alignItems: 'center',
													padding: '4px 0',
												}}
											>
												<Text
													className="m-0 text-[13px] text-gray-600"
													style={{ margin: 0 }}
												>
													{shift.start} - {shift.end}
												</Text>
												<Text
													className="m-0 font-medium text-[13px] text-black"
													style={{ margin: 0 }}
												>
													{shift.duration}
												</Text>
											</div>
										))}
									</div>
								))
							)}
						</Section>

						<Section className="mt-[32px] mb-[32px] text-center">
							<Button
								className="rounded bg-[#000000] px-5 py-3 text-center font-semibold text-[12px] text-white no-underline"
								href={linkWithParams}
							>
								View Dashboard
							</Button>
						</Section>

						<Hr className="mx-0 my-[26px] w-full border border-[#eaeaea] border-solid" />

						<Text className="text-center text-[12px] text-gray-500 leading-[24px]">
							Sent automatically by{' '}
							<Link
								className="text-blue-600 no-underline"
								href={linkWithParams}
							>
								Clock Out
							</Link>
							.
						</Text>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	)
}

export default WeeklyReportEmail
