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

interface ShiftAlertEmailProps {
  title: string;
  body: string;
  /** Absolute link the button opens. */
  actionUrl: string;
  /** Public origin of the app, for the logo and the preferences link. */
  appUrl: string;
}

/** One alert (forgot to clock out, auto clock-out, still on break) by email. */
export const ShiftAlertEmail = ({
  title,
  body,
  actionUrl,
  appUrl,
}: ShiftAlertEmailProps) => {
  const preferencesUrl = `${appUrl}/?defaultTab=notifications`;
  return (
    <Html>
      <Head />
      <Preview>{body}</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-gray-50 px-2 font-sans">
          <Container className="mx-auto my-[40px] max-w-[465px] rounded border border-gray-200 border-solid bg-white p-[20px]">
            <Section className="mt-[16px] text-center">
              <Img
                alt="Clock Out"
                className="mx-auto rounded-[14px]"
                height="56"
                src={`${appUrl}/icon-192.png`}
                width="56"
              />
            </Section>
            <Heading className="mx-0 my-[24px] p-0 text-center font-normal text-[22px] text-black">
              {title}
            </Heading>
            <Text className="text-[14px] text-black leading-[24px]">
              {body}
            </Text>
            <Section className="mt-[24px] mb-[24px] text-center">
              <Button
                className="rounded bg-[#000000] px-5 py-3 text-center font-semibold text-[12px] text-white no-underline"
                href={actionUrl}
              >
                Open Clock Out
              </Button>
            </Section>
            <Hr className="mx-0 my-[26px] w-full border border-[#eaeaea] border-solid" />
            <Text className="text-center text-[12px] text-gray-500 leading-[24px]">
              You're getting this because your organization turned on shift
              alerts.{" "}
              <Link
                className="text-blue-600 no-underline"
                href={preferencesUrl}
              >
                Manage notifications
              </Link>
              .
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default ShiftAlertEmail;
