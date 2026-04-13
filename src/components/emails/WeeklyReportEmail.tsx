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
} from "@react-email/components";
import { Tailwind } from "@react-email/tailwind";

interface WeeklyReportEmailProps {
  userName: string;
  totalHours: string;
  periodStart: string;
  periodEnd: string;
  chartUrl: string;
  dashboardUrl: string;
  userId?: string;
  week?: string;
  month?: string;
  year?: string;
  breakdown: { date: string; shifts: { start: string; end: string; duration: string }[] }[];
}

export const WeeklyReportEmail = ({
  userName = "User",
  totalHours = "0h 0m",
  periodStart = "Jan 1, 2024",
  periodEnd = "Jan 7, 2024",
  chartUrl = "",
  dashboardUrl = "https://clockout.patmac.ca",
  userId = "",
  week = "",
  month = "",
  year = "",
  breakdown = [],
}: WeeklyReportEmailProps) => {
  let linkWithParams = `${dashboardUrl}/?defaultTab=view&timeframe=week`;
  if (userId) linkWithParams += `&userId=${userId}`;
  if (week) linkWithParams += `&week=${week}`;
  if (month) linkWithParams += `&month=${month}`;
  if (year) linkWithParams += `&year=${year}`;

  return (
    <Html>
      <Head />
      <Preview>Weekly Hours Report for {userName}</Preview>
      <Tailwind>
        <Body className="bg-gray-50 my-auto mx-auto font-sans px-2">
          <Container className="border border-solid border-gray-200 rounded my-[40px] mx-auto p-[20px] max-w-[465px] bg-white">
            <Heading className="text-black text-[24px] font-normal text-center p-0 my-[30px] mx-0">
              Time Report
            </Heading>
            <Text className="text-black text-[14px] leading-[24px]">
              Hello Admin,
            </Text>
            <Text className="text-black text-[14px] leading-[24px]">
              Here is the weekly hours report for <strong>{userName}</strong> from {periodStart} to {periodEnd}.
            </Text>
            <Text className="text-black text-[14px] leading-[24px]">
              <strong>Total Hours Logged:</strong> {totalHours}
            </Text>

            {chartUrl && (
              <Section className="my-[20px]">
                <Img src={chartUrl} alt="Hours Chart" className="w-full rounded-md border border-gray-200" />
              </Section>
            )}

            <Section className="mt-[32px]">
              <Heading className="text-black text-[18px] font-bold m-0 mb-4">
                Detailed Breakdown
              </Heading>
              {breakdown.length === 0 ? (
                <Text className="text-gray-500 text-[14px]">No hours logged in this period.</Text>
              ) : (
                breakdown.map((day) => (
                  <div key={day.date} style={{ marginBottom: '24px' }}>
                    <Text className="text-black text-[14px] font-bold m-0 border-b border-gray-200 pb-1 mb-2">
                      {day.date}
                    </Text>
                    {day.shifts.map((shift, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                        <Text className="text-gray-600 text-[13px] m-0" style={{ margin: 0 }}>
                          {shift.start} - {shift.end}
                        </Text>
                        <Text className="text-black text-[13px] font-medium m-0" style={{ margin: 0 }}>
                          {shift.duration}
                        </Text>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </Section>

            <Section className="text-center mt-[32px] mb-[32px]">
              <Button
                className="bg-[#000000] rounded text-white text-[12px] font-semibold no-underline text-center px-5 py-3"
                href={linkWithParams}
              >
                View Dashboard
              </Button>
            </Section>

            <Hr className="border border-solid border-[#eaeaea] my-[26px] mx-0 w-full" />
            
            <Text className="text-gray-500 text-[12px] leading-[24px] text-center">
              Sent automatically by <Link href={linkWithParams} className="text-blue-600 no-underline">Clock Out</Link>.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default WeeklyReportEmail;
