import Link from "next/link";
import { MailIcon, ShieldIcon } from "@/components/ui/Icons";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <div className="mb-12">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
          <ShieldIcon className="h-6 w-6" />
        </div>
        <h1 className="font-black text-4xl text-zinc-900 tracking-tight md:text-5xl dark:text-zinc-50">
          Privacy Policy
        </h1>
        <p className="mt-4 text-lg text-zinc-500 dark:text-zinc-400">
          Last updated: November 11, 2026
        </p>
      </div>

      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <section className="mb-12">
          <h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
            Our Data Commitment
          </h2>
          <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-6 dark:border-blue-900/30 dark:bg-blue-900/10">
            <p className="m-0 font-medium text-blue-900 dark:text-blue-100">
              We value your trust. Our policy is simple:
              <strong className="mt-2 block">
                We do not sell your data. We do not use your data for AI
                training. We only share data with essential service providers
                necessary for the application to function.
              </strong>
            </p>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
            1. Data Collection
          </h2>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">
            We collect information you provide directly to us, such as when you
            create an account, log time entries, or communicate with us. This
            includes your name, email address, organization details, and time
            tracking data. If you clock in or out with location enabled, we also
            record the location of that punch so your organization can confirm
            it happened at a work site.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
            2. Data Usage
          </h2>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">
            Your data is used solely to provide the Clock Out service, including
            tracking hours, generating reports, and managing organization
            memberships.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
            3. Data Sharing
          </h2>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">
            We only share your data with third-party vendors necessary for
            business functions:
          </p>
          <ul className="mt-4 list-disc pl-6 text-zinc-600 dark:text-zinc-400">
            <li>
              <strong>Clerk:</strong> For authentication and user management.
            </li>
            <li>
              <strong>Neon:</strong> For hosted database storage.
            </li>
            <li>
              <strong>AWS SES:</strong> For sending automated email reports.
            </li>
            <li>
              <strong>Vercel:</strong> For hosting the application.
            </li>
            <li>
              <strong>Google Firebase:</strong> For sending push notifications
              to your devices.
            </li>
            <li>
              <strong>Geoapify:</strong> For turning punch locations into street
              addresses.
            </li>
          </ul>
        </section>

        <section className="mb-12">
          <h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
            4. Google User Data
          </h2>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">
            You can sign in with Google, and you can choose to add your shifts
            to your Google Calendar. When you do, Clock Out accesses the
            following Google user data:
          </p>
          <ul className="mt-4 list-disc pl-6 text-zinc-600 dark:text-zinc-400">
            <li>
              <strong>Basic profile (Google sign-in):</strong> your name, email
              address and profile picture, used only to create and identify your
              Clock Out account.
            </li>
            <li>
              <strong>Google Calendar events</strong> (
              <code>calendar.events</code> scope, only if you tap a Google
              Calendar button): used only to create, update and remove the
              events for your own Clock Out shifts on your primary calendar.
              Clock Out does not read, list, copy or store any other events on
              your calendar.
            </li>
          </ul>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">
            Google user data is never sold, never used for advertising, never
            used to train AI or machine-learning models, and never shared with
            anyone except as needed to provide these features, to comply with
            the law, or with your consent. Clock Out&apos;s use and transfer of
            information received from Google APIs adheres to the{" "}
            <a
              className="underline underline-offset-4"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              rel="noopener noreferrer"
              target="_blank"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
            5. How We Protect Your Data
          </h2>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">
            We use the following safeguards to protect your data, including
            sensitive data such as Google access tokens, location and pay
            information:
          </p>
          <ul className="mt-4 list-disc pl-6 text-zinc-600 dark:text-zinc-400">
            <li>
              <strong>Encryption in transit:</strong> all traffic to Clock Out
              and between Clock Out and its service providers uses HTTPS/TLS,
              and browsers are required to use HTTPS (HSTS).
            </li>
            <li>
              <strong>Encryption at rest:</strong> our database (Neon) and
              authentication provider (Clerk) encrypt stored data at rest.
            </li>
            <li>
              <strong>Google tokens:</strong> Google OAuth access and refresh
              tokens are held by Clerk, our authentication provider, and are
              never stored in the Clock Out database, written to logs or shown
              to other users. They are fetched only at the moment a shift is
              written to your calendar.
            </li>
            <li>
              <strong>Least privilege:</strong> we request only the minimum
              Google scope needed (calendar events), and every request to our
              servers is authenticated and limited to your own account and
              organization.
            </li>
            <li>
              <strong>Restricted access:</strong> only the developer of Clock
              Out can access production systems, protected by multi-factor
              authentication, and only to operate, secure or support the
              service.
            </li>
            <li>
              <strong>Application security:</strong> we use security headers
              (including a Content Security Policy and anti-clickjacking
              protection), rate limiting and input validation.
            </li>
          </ul>
        </section>

        <section className="mb-12">
          <h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
            6. Data Retention and Deletion
          </h2>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">
            We keep your account and time tracking data for as long as your
            account is active, so you and your organization can view past hours,
            reports and payroll records.
          </p>
          <ul className="mt-4 list-disc pl-6 text-zinc-600 dark:text-zinc-400">
            <li>
              <strong>Google user data:</strong> Clock Out does not keep a copy
              of your Google Calendar data. Your Google tokens are kept by Clerk
              only while your Google account is linked to Clock Out. When you
              unlink Google, or delete your account, the tokens are deleted. You
              can also revoke Clock Out&apos;s access at any time from your{" "}
              <a
                className="underline underline-offset-4"
                href="https://myaccount.google.com/permissions"
                rel="noopener noreferrer"
                target="_blank"
              >
                Google Account permissions
              </a>{" "}
              page. Calendar events Clock Out created stay on your calendar
              until you delete them.
            </li>
            <li>
              <strong>Deleting your data:</strong> you can request deletion of
              your account and all associated data, including any Google user
              data, by emailing us at the address below. We will delete it
              within 30 days, except where we are legally required to keep
              certain records (for example, payroll records), which we keep only
              as long as required and then delete.
            </li>
            <li>
              <strong>Backups:</strong> deleted data may remain in encrypted
              database backups for a limited time until those backups expire.
            </li>
          </ul>
        </section>

        <section className="mb-12">
          <h2 className="font-bold text-2xl text-zinc-900 dark:text-zinc-50">
            7. Contact Us
          </h2>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">
            If you have any questions about this Privacy Policy, please contact
            Patrick MacDonald at:
          </p>
          <div className="mt-4 flex items-center gap-2 text-zinc-900 dark:text-zinc-50">
            <MailIcon className="h-5 w-5 text-zinc-400" />
            <a
              className="font-medium underline underline-offset-4"
              href="mailto:patrick@patmac.ca"
            >
              patrick@patmac.ca
            </a>
          </div>
        </section>
      </div>

      <div className="mt-20 border-zinc-200 border-t pt-8 dark:border-zinc-800">
        <Link
          className="font-medium text-sm text-zinc-900 transition-colors hover:text-blue-600 dark:text-zinc-50 dark:hover:text-blue-400"
          href="/"
        >
          &larr; Back to Dashboard
        </Link>
      </div>
    </main>
  );
}
