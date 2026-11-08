# Clock Out

Clock Out is a multi-organization time-tracking and weekly timecard app. Team members clock in and out, admins manage everyone's shifts, and hours can be exported as PDF/Excel timesheets or emailed as scheduled reports. It also ships a full **MCP server**, so AI assistants (Claude, ChatGPT, Gemini, Muse, …) can clock people in, read timecards, import shifts from a photo of a paper timecard, and run hours reports — all against the same data as the web app.

Live app: https://clockout.patmac.ca

## Features

- **Organizations** — every user belongs to one or more organizations with `org:admin` / `org:member` roles. Admins can invite members by email, clock anyone in or out, and edit or delete any shift.
- **Time clock** — live clock in/out, plus manual entries. Overlapping or duplicate shifts are strictly rejected, in single adds and in batches.
- **Breaks & lunch deductions** — shifts can record breaks/meal periods, and each organization can automatically dock unpaid lunch time (`dock_lunch`, `lunch_duration_minutes`, `lunch_min_shift_hours`). Totals in timecards, exports, and reports are net of these deductions.
- **Geolocation & geofenced clock-in** — each organization can set location capture to off, optional, or required, define named job **sites** (latitude/longitude with a radius, 150 m by default), and optionally restrict clock-in to punches inside a site. Every punch stores its coordinates, accuracy, and the matched site's name, and the allow/deny decision is made server-side.
- **Weekly timecards** — per-member totals, days worked, and day-by-day breakdowns, with charts.
- **Timesheet export** — server-generated PDF and Excel (.xlsx) timesheets for any period, grouped by week or month.
- **Shift alerts & auto clock-out** — "forgot to clock out" reminders after N hours, an optional automatic clock-out at an org-set limit (the shift is closed at exactly clock-in + limit), and "forgot to end break" reminders. Each member picks email, push or both (and which alerts) under **Notifications**; admins can get a copy of every alert. Push goes through Firebase Cloud Messaging and arrives within seconds of the alert falling due; it works on Android, desktop, and iPhone/iPad once the app is added to the Home Screen. See [Shift alerts & notifications](#shift-alerts--notifications).
- **Canadian payroll deductions (optional)** — admins can turn on estimated CPP/QPP, CPP2/QPP2 and EI deductions and net pay beside gross pay, for their province or territory (Quebec uses QPP and Quebec EI rates). Rates are stored as data and kept current from the CRA automatically. See [Payroll deductions](#payroll-deductions-canada).
- **Emailed hours reports** — organizations on a plan with the Reporting feature can schedule automatic report emails (weekly, bi-weekly, twice-monthly/pay-period, or a custom weekday every 1–2 weeks) and run ad-hoc reports for any date range.
- **MCP server** — 18 tools over Streamable HTTP with Clerk OAuth sign-in (see below).

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- [Clerk](https://clerk.com) — authentication, Organizations, Billing (plans/features), and the OAuth provider for MCP
- [Neon](https://neon.tech) serverless Postgres (`@neondatabase/serverless`)
- [Model Context Protocol](https://modelcontextprotocol.io) — `@modelcontextprotocol/server` + `mcp-handler`
- Tailwind CSS 4, Recharts, React Email + Amazon SES for report email
- Firebase Cloud Messaging for push, Upstash QStash for exactly-timed alerts
- Deployed on Vercel (with daily Vercel Cron jobs for reports, payroll rates and an alert safety net); Biome for lint/format; Vitest for tests

## Getting started

```bash
bun install
bun dev
```

Open http://localhost:3000. Other scripts:

```bash
bun run build            # production build
bun run test             # vitest run (every project)
bun run test:unit        # lib, hooks and other unit tests
bun run test:components  # React component tests
bun run test:app         # pages and API route handlers
bun run test:build       # next build, then check every page keeps a static shell
bun run test:coverage    # all tests with the 100% coverage gate
bun run typecheck        # next typegen && tsc --noEmit
bun run lint             # biome check --write --unsafe
bun run format           # biome format --write
```

### Environment variables

| Variable                                                                                                                                     | Purpose                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                                                                                                          | Clerk publishable key. The MCP OAuth issuer is derived from it, so it also decides which Clerk instance issues MCP tokens.                                             |
| `CLERK_SECRET_KEY`                                                                                                                           | Clerk secret key (used by `@clerk/nextjs`).                                                                                                                            |
| `CLERK_WEBHOOK_SIGNING_SECRET`                                                                                                               | Verifies Clerk webhooks at `/api/webhooks/clerk`.                                                                                                                      |
| `DATABASE_URL`                                                                                                                               | Neon Postgres connection string.                                                                                                                                       |
| `NEXT_PUBLIC_APP_URL`                                                                                                                        | Public origin of the deployment (e.g. `https://clockout.patmac.ca`); used as the MCP server's website/icon origin.                                                     |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`                                                                                   | Amazon SES credentials for report email.                                                                                                                               |
| `SES_FROM_EMAIL`                                                                                                                             | From address for report email.                                                                                                                                         |
| `CRON_SECRET`                                                                                                                                | Bearer secret guarding `/api/cron/weekly-report`, `/api/cron/payroll-rates` and `/api/cron/shift-alerts` (all called daily by Vercel Cron).                            |
| `CALENDAR_FEED_SECRET`                                                                                                                       | Signs calendar feed URLs. Falls back to `CLERK_SECRET_KEY` with a logged warning; set it so rotating the Clerk key doesn't break every feed.                           |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`                                                                                          | Legacy Web Push (VAPID) key pair; also the default Web Push certificate for FCM (import it into Firebase).                                                             |
| `FIREBASE_SERVICE_ACCOUNT`                                                                                                                   | Firebase service account key file (JSON, or base64 of it) the server sends FCM push with.                                                                              |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | The Firebase web app's config, for registering devices with FCM. FCM push is off until these and the service account are set.                                          |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY`                                                                                                             | Optional: the Firebase project's Web Push certificate, when it isn't the imported `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.                                                      |
| `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`                                                                      | Upstash QStash credentials for exactly-timed alert jobs (Production only). Optional `QSTASH_URL` for a regional QStash URL.                                            |
| `VAPID_SUBJECT`                                                                                                                              | Optional contact for push services, e.g. `mailto:you@example.com`. Defaults to `NEXT_PUBLIC_APP_URL`.                                                                  |
| `MCP_ALLOWED_OAUTH_CLIENT_IDS`                                                                                                               | Optional: comma-separated Clerk OAuth client IDs allowed to use the MCP server and `/api/export/timesheet`. Unset accepts any client registered on the Clerk instance. |

### Database

The schema lives in `schema.sql` and is applied to Neon Postgres. Tables: `time_entries` (including clock-in/out location columns), `time_entry_breaks`, `settings`, `reporting_settings`, `break_settings`, `location_settings`, `sites`, `alert_settings`, `notification_preferences`, `push_subscriptions`, `fcm_tokens`, `sent_alerts`, `alert_jobs`. Users, organizations, memberships, and subscriptions live in Clerk, not in this database.

## MCP server

### Endpoint and discovery

```
POST https://clockout.patmac.ca/api/mcp
```

Streamable HTTP transport. The server identifies itself as `clock-out` ("Clock Out", version `1.0.0`) and sends usage instructions to clients during the `initialize` handshake.

Discovery documents (served from the app origin, CORS-open):

| URL                                       | What it is                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/.well-known/oauth-protected-resource`   | RFC 9728 Protected Resource Metadata: names the MCP endpoint as the resource and Clerk as its authorization server.                                       |
| `/.well-known/oauth-authorization-server` | Clerk's OAuth authorization-server metadata, proxied from the Clerk instance for clients that look for it on the resource's own domain (2025-03-26 spec). |
| `/.well-known/openid-configuration`       | Clerk's OpenID Connect discovery document, proxied the same way.                                                                                          |

### Connecting a client

In your AI app, add a custom MCP connector with the server URL `https://clockout.patmac.ca/api/mcp` and sign in with your Clock Out account when prompted. There is nothing to configure per client: clients register themselves with Clerk automatically (dynamic client registration or a Client ID Metadata Document), and the app's dashboard shows the same URL with a copy button (the "Connect AI (MCP Server)" card).

### Authentication

MCP uses **Clerk as an OAuth 2.0 authorization server**:

1. The client discovers Clerk from the metadata above and registers itself (DCR or CIMD).
2. The user signs in to Clock Out with Clerk and approves access.
3. Clerk issues an OAuth access token for the scopes **`profile`, `email`, `offline_access`** — nothing more is requested; the token only needs to say who signed in. `offline_access` gets the client a refresh token so it stays connected (Google/Gemini account linking requires it).
4. The client sends the token as a `Bearer` header. The server verifies it on every request with Clerk's `authenticateRequest` (`acceptsToken: "oauth_token"`) and acts as that Clerk user, with that user's organization roles.

An unauthenticated request gets a `401` with a `WWW-Authenticate` header pointing at the protected-resource metadata, per RFC 9728.

### Tools (18)

Read-only tools are marked _(read)_. Most tools accept `org_id` (an organization ID, slug, or name); with a single organization it can be omitted, and members are identified by name, email, or `user_id`. Time inputs take an IANA `timezone` (default `America/Edmonton`).

| Tool                           | What it does                                                                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_organizations` _(read)_  | Lists the organizations the signed-in user belongs to, with `org_id`, name, slug, and their role.                                                                                                                           |
| `list_members` _(read)_        | Lists an organization's members (name, email for admins, role, currently clocked in?).                                                                                                                                      |
| `who_is_working` _(read)_      | Who is clocked in right now, since when, and for how long — plus who is clocked out.                                                                                                                                        |
| `get_clock_status` _(read)_    | Whether you (or a member, for admins) are clocked in, whether a break is running, and how long the shift has run.                                                                                                           |
| `clock_in`                     | Starts a shift for yourself, or for any member if you're an admin. Rejects double clock-ins and overlaps.                                                                                                                   |
| `clock_out`                    | Ends the active shift for yourself or (admin) any member; optional custom clock-out time.                                                                                                                                   |
| `toggle_break`                 | Starts, ends, or toggles a live break (`unpaid_meal`, `unpaid_rest`, or `paid_rest`) on an active shift for yourself or (admin) any member.                                                                                 |
| `manage_breaks`                | _(Admin for add/update/delete; anyone for list/start/end/toggle)_ Adds, edits, deletes, or lists breaks of the 3 kinds (`unpaid_meal`, `unpaid_rest`, `paid_rest`) on a shift.                                              |
| `add_time_entry`               | Adds one shift or a batch (`entries` array) — the tool to use when importing a photographed paper timecard or schedule. Strictly rejects overlapping shifts.                                                                |
| `list_time_entries` _(read)_   | Lists shifts between `start_date` and `end_date` (default last 7 days) with durations; admins can filter by member or use `member: "all"`.                                                                                  |
| `get_weekly_timecard` _(read)_ | Weekly timecard: totals, days worked, and day-by-day breakdowns. Supports `week_of`, explicit dates, or the month-week selector (year, month, week 1–4).                                                                    |
| `export_timesheet` _(read)_    | Generates PDF **and** Excel timesheets for a period (group by week/month) and returns embedded files plus signed-in download links.                                                                                         |
| `update_time_entry`            | _(Admin)_ Changes `clock_in`/`clock_out`/`hours_worked`/`skip_lunch` on an existing entry, by `entry_id` or member + date. Overlap-checked.                                                                                 |
| `delete_time_entry`            | _(Admin)_ Permanently deletes a time entry by `entry_id`.                                                                                                                                                                   |
| `manage_reporting_settings`    | Views or updates the emailed-report schedule (`off`, `weekly`, `bi-weekly`, `twice-monthly`, `custom` weekday every 1–2 weeks) or sends a test report. Updating requires `org:admin` and a plan with the Reporting feature. |
| `manage_break_settings`        | Views, updates, or toggles the lunch/break deduction: `dock_lunch` on/off, `lunch_duration_minutes`, `lunch_min_shift_hours`. Anyone can view; updating is `org:admin`. Available on every plan.                            |
| `run_hours_report`             | _(Admin, Reporting feature)_ Net hours (after break deductions) for one member or everyone between two dates, with daily breakdowns. `deliver`: return in chat (default), `email_admins`, or `both`.                        |
| `invite_member`                | _(Admin)_ Sends organization invitations by email (`action: "send"`, role `org:member` or `org:admin`), lists pending invitations (`"list"`), or revokes one (`"revoke"`).                                                  |

Rules the server enforces and tells clients about: never create duplicate/overlapping shifts (edit the existing entry instead); only edit/delete when the user explicitly asks; report hours are net of break deductions; exporting always returns both the PDF and spreadsheet links.

Location capture and geofencing are web-app features — the browser supplies the coordinates at punch time — so the MCP tools take no location input.

### Roles & permissions

- **Members** (`org:member`): clock themselves in/out, manage their own shifts, view their own entries/timecards, and see who is working.
- **Admins** (`org:admin`): everything above for every member, plus invites, entry edit/delete for anyone, break settings, and — with the Reporting plan feature — reporting settings and hours reports.

## Clerk setup

Clock Out leans on Clerk for more than sign-in. Everything a fresh Clerk instance needs turned on — in the Clerk Dashboard for the production instance — is in this one table:

| #   | Clerk setting                       | Exact value                                                                                                      | Used for                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Organizations                       | Enabled, with the built-in roles `org:admin` and `org:member`                                                    | The app is multi-tenant on Clerk orgs; memberships, organization invitations (web UI and the MCP `invite_member` tool), and every admin-only check depend on it                                                                                                                  |
| 2   | Billing                             | Clerk Billing enabled, with organization subscription plans                                                      | Organizations subscribe to plans; the plan features below are attached to plans and checked with `has({ feature: … })`                                                                                                                                                           |
| 3   | Billing feature                     | **`reporting`**                                                                                                  | Report scheduling and running — gated by `has({ feature: "reporting" })`, including the MCP tools `manage_reporting_settings` and `run_hours_report`. Plans without it can still use everything else, including break settings                                                   |
| 4   | Billing feature                     | **`geofencing`**                                                                                                 | Location capture, job sites, and geofenced clock-in — gated by `has({ feature: "geofencing" })`                                                                                                                                                                                  |
| 5   | Billing feature                     | **`download_graph`**                                                                                             | Downloading the hours charts on the View Hours page — gated by `has({ feature: "download_graph" })`                                                                                                                                                                              |
| 6   | OAuth provider                      | Clerk enabled as an OAuth 2.0 authorization server                                                               | MCP clients (Claude, ChatGPT, Gemini, …) sign users in and receive access tokens the API verifies                                                                                                                                                                                |
| 7   | OAuth provider setting              | **Dynamic Client Registration (DCR)** — on                                                                       | MCP clients register themselves at `/oauth/register` instead of being created by hand                                                                                                                                                                                            |
| 8   | OAuth provider setting              | **Client ID Metadata Documents (CIMD)** — on                                                                     | The other registration route some MCP clients use                                                                                                                                                                                                                                |
| 9   | OAuth scopes                        | **`profile`**, **`email`**, **`offline_access`** grantable to registered clients                                 | The scopes the MCP server requests. `offline_access` matters: without it clients get no refresh token and keep dropping the connection (Gemini account linking fails outright). No per-client setup is needed or wanted — don't create manual OAuth applications for MCP clients |
| 10  | Webhook endpoint                    | `https://<your-domain>/api/webhooks/clerk`                                                                       | Receives Clerk events at `/api/webhooks/clerk`; its signing secret goes in `CLERK_WEBHOOK_SIGNING_SECRET`                                                                                                                                                                        |
| 11  | Webhook event                       | **`subscriptionItem.*`** and **`subscription.*`** (at least `active`, `canceled`, `ended`, `pastDue`, `updated`) | Each one re-reads the organization's live subscription and sets its member limit, so cancellations and downgrades lower it                                                                                                                                                       |
| 12  | Production instance + custom domain | Instance Frontend API domain `https://clerk.clockout.patmac.ca`                                                  | The MCP OAuth issuer is derived from the publishable key; MCP discovery, token verification, and every client's stored connection key off that issuer                                                                                                                            |
| 13  | Sign-in methods                     | Email/password and/or social, under User & Authentication                                                        | Normal user sign-in to the web app; MCP sign-in rides on the same Clerk sign-in                                                                                                                                                                                                  |

App-side, Clerk is wired in through `src/proxy.ts` (`clerkMiddleware`, protecting `/dashboard(.*)`) and `@clerk/nextjs` providers; no JWT templates or custom session claims are used — MCP token verification is done by Clerk's `authenticateRequest`, not by checking JWT claims in app code.

## Adding shifts to Google Calendar

On the Schedule page, **Google Calendar** (per shift) and **Add all to Google Calendar** (members' upcoming shifts) write the events straight to the user's primary Google Calendar through the Calendar API, using the Google token Clerk holds for their linked Google account. The first time, Clerk sends the user to Google to allow calendar access (or to link Google if they signed up with email); they come back to the Schedule page and the add finishes on its own. Adding a shift again updates its event instead of duplicating it. If the API call fails for any other reason, the old prefilled Google link opens as a fallback.

Only the `https://www.googleapis.com/auth/calendar.events` scope is requested, and only from users who tap the button, so nothing changes for anyone else's sign-in. One-time setup in the Google Cloud project behind Clerk's Google connection (the custom credentials in Clerk → SSO connections → Google):

1. **APIs & Services → Library →** enable the **Google Calendar API**.
2. **OAuth consent screen → Data access →** add the `.../auth/calendar.events` scope. While the app is in _Testing_, only listed test users can grant it; publish (and complete Google's verification for this sensitive scope) for everyone else.

No new env vars are needed. Until step 1 is done, the button shows "Google Calendar isn't set up for Clock Out yet" and opens the fallback link. Don't add the calendar scope to Clerk's Google connection settings: Clerk asks for it only from users who tap the button, so everyone else's sign-in is unchanged.

Once a member has allowed calendar access, shifts an admin adds, moves or cancels for them are mirrored to their Google Calendar automatically after the change is saved (`mirrorShiftToGoogleCalendar`). Members who never tapped the button are left alone.

Apple Calendar and Outlook users can instead subscribe to a feed of their shifts, under "Use Apple Calendar or Outlook instead?" on the Schedule page. That adds a separate "Clock Out shifts" calendar, so it's no longer offered for Google. The feed URLs are signed with `CALENDAR_FEED_SECRET`. Set it: without it they fall back to `CLERK_SECRET_KEY` (and log a warning), so rotating the Clerk key would break every feed. Members can reset their own link from the Schedule page.

## Deployment

Deployed on Vercel. `vercel.json` registers a daily cron (`0 6 * * *`) hitting `/api/cron/weekly-report`, which sends any scheduled report emails that are due; the route requires the `CRON_SECRET` bearer token. A second daily cron (`0 19 * * *`, 12:00 p.m. MST) hits `/api/cron/payroll-rates` to pick up new CRA payroll rates. A third (`0 12 * * *`) hits `/api/cron/shift-alerts`, the safety net behind the exactly-timed alert jobs (see [How it runs](#how-it-runs-exactly-timed-no-polling)). Email goes out through Amazon SES using React Email templates.

## Payroll deductions (Canada)

Admins turn this on under **Settings → Payroll Deductions** and pick the province or territory of employment. The Hours view then shows estimated CPP (QPP in Quebec), CPP2/QPP2 and EI, and net pay before income tax, worked out per member per Monday–Sunday week with the CRA's T4127 formulas (basic exemption prorated over 52 periods; contributions stop at the annual maximums). Income tax and QPIP aren't calculated, and the year-to-date maximums only count the hours on screen.

- **Rates are data.** Each row in `payroll_rates` is one jurisdiction (`CA` = Canada except Quebec, `QC`) from one T4127 edition, keyed by the date it takes effect. A pay week uses the latest row on or before its date, so past years keep their own rates. The 2026 figures ship as seed rows in `src/lib/payroll.ts`.
- **Updates are automatic.** `GET /api/cron/payroll-rates` (bearer `CRON_SECRET`) reads the [T4127 index](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas.html), follows the newest edition, downloads its CSV tables 8.3 (CPP/QPP), 8.6 (CPP2/QPP2) and 8.7 (EI), and stores a jurisdiction only when its figures changed. Every row is checked first (each published maximum has to match its rate and ceiling); a row that fails, or a page or file whose layout changed, is logged and skipped and the current rates stay in use. No new env vars are needed.

## Shift alerts & notifications

Long-running entries used to inflate totals silently. Admins now set rules under **Settings → Shift Alerts** (all off by default):

| Rule                | What happens                                                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forgot to clock out | After _N_ hours on the clock (default 10), the member gets one reminder.                                                                                                                                                     |
| Automatic clock-out | After _N_ hours (default 16), the shift is closed at exactly clock-in + _N_. Breaks are trimmed to the new end (a running break is also capped at its type's limit) and the member is told. Must be later than the reminder. |
| Forgot to end break | When a break has run _N_ minutes (default 45) — or reaches its type's time limit, if that's sooner — the member is reminded they're still on break / back on the clock.                                                      |
| Notify admins too   | Every alert is also sent to the org's admins (an admin's own shift isn't sent to them twice).                                                                                                                                |

Every person picks **email, push or both** — and which alerts they want — on the **Notifications** tab, where they can also turn push on/off per device and send themselves a test. Each alert is sent once (tracked in `sent_alerts`), and at the moment it falls due (see [How it runs](#how-it-runs-exactly-timed-no-polling)).

### Schedule notifications

Members also hear about their published schedule (admins can switch this off under **Settings → Shift Alerts → Schedule notifications**; members can opt out with the **My schedule** topic, using the same email/push choice):

- **Weekly schedule:** on Sunday from 5 PM in the member's own time zone, they get the coming Monday–Sunday — one line per shift, plus the total hours. Sent once per week, and only if they have shifts.
- **Upcoming shift:** an hour before each scheduled shift, the member gets a reminder with its start time (scheduled to the second when the shift is published, or right away if it starts within the hour). Sent once per shift, and skipped if they've already clocked in.
- **Changes:** when an admin adds or removes one of their upcoming shifts, the member is told straight away (sent with `after()` once the admin's save is answered — not on the cron). Shifts in the past, and admins scheduling themselves, don't notify.

Times are written in each person's own time zone, which the app remembers from their browser when they open the dashboard. Until it knows, the admin's zone is used for change notices and UTC (labelled) for the weekly schedule.

### How it runs (exactly timed, no polling)

Nothing polls. Every alert is scheduled for the second it falls due, the moment something decides that time:

- **Clock-in, clock-out, break start/end, entry or break edits and deletes** (web app and MCP), **Shift Alerts rule changes** and **break limit changes** reschedule the org's next shift alert. Each org has at most **one** pending [Upstash QStash](https://upstash.com/docs/qstash) message, set (`notBefore`) for its earliest pending alert — forgot to clock out, automatic clock-out, still on break or "your break is over". Clocking out early, or turning a rule off, moves or cancels it.
- **Adding, moving or cancelling a scheduled shift** schedules (or cancels) its "starts in an hour" reminder.
- **Weekly schedules** are scheduled for Sunday 5 PM in each member's time zone.

QStash delivers each job to **`POST /api/alerts/dispatch`**, which accepts only requests signed by QStash (for that exact URL and body), re-checks the database (still clocked in? still on break? shift unchanged?), sends what is due over email/push, and schedules the next one. A duplicate, early, late or retried delivery is harmless: every alert is still claimed once in `sent_alerts`. Pending jobs live in `alert_jobs` so they can be moved or cancelled. A job fails with a 5xx only when it should be retried (QStash retries 3 times).

Notices caused by an action itself (an admin adding, moving or removing a member's shift) are sent straight from that request with `after()`, not queued.

**Daily safety net:** Vercel Cron calls `GET /api/cron/shift-alerts` (bearer `CRON_SECRET`) once a day. It catches up on anything due that slipped through (a failed publish, QStash not configured yet), schedules reminders for shifts that have come within six days (QStash's free plan caps delays at 7 days), re-arms each org's next alert, and forgets FCM tokens no device has refreshed in 240 days. It works on Vercel Hobby, and replaces the old every-10-minutes GitHub Actions workflow.

#### QStash setup

1. Create a QStash project at [console.upstash.com](https://console.upstash.com/qstash) (the free plan is plenty), or add the Upstash integration in Vercel.
2. In Vercel → Settings → Environment Variables, **Production only** (preview deployments share the database and would otherwise schedule duplicate jobs) add `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`. Add `QSTASH_URL` too if the console shows a regional URL (e.g. `https://qstash-eu-central-1.upstash.io`).
3. Jobs are delivered to `NEXT_PUBLIC_APP_URL` (default `https://clockout.patmac.ca`) + `/api/alerts/dispatch`, so that origin must be publicly reachable (no Vercel Deployment Protection on it).

Without these, nothing is scheduled and alerts only go out on the daily run.

### Email (Amazon SES)

Uses the SES setup the reports already use (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `SES_FROM_EMAIL`). Alerts go to the address on the member's Clerk account. If SES is still in sandbox mode, recipients must be verified, so request production access in the SES console before rolling out.

### Push notifications (Firebase Cloud Messaging)

Push goes through [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging) (FCM) with `Urgency: high`, so it arrives within seconds — on Android even when the phone is asleep. The installed app on Android, desktop browsers and iPhone/iPad Home Screen apps (iOS 16.4+) all register with FCM. The server calls the FCM HTTP v1 API directly with a service account (no Admin SDK); the browser loads only `@firebase/app` + `@firebase/messaging`, and only while registering. Notifications are still drawn by the app's own service worker (`public/sw.js`), so they look the same everywhere.

Devices are stored per user in `fcm_tokens`. Each visit to the dashboard refreshes the device's token (Firebase rotates them) and marks it as seen; tokens FCM reports as `UNREGISTERED`, invalid or from another project are deleted on send.

**Setup**

1. Create (or reuse) a Firebase project, add a **Web app**, and note its config (`apiKey`, `projectId`, `messagingSenderId`, `appId`).
2. Project settings → **Cloud Messaging** → **Web Push certificates** → **Import an existing key pair**, and paste the current `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`. Devices already on Web Push then move to FCM on their next visit without being asked again. (You can generate a new pair instead and set `NEXT_PUBLIC_FIREBASE_VAPID_KEY`; existing devices are then re-subscribed silently, as long as notification permission is still granted.)
3. Project settings → **Service accounts** → **Generate new private key**. Put the whole JSON file in `FIREBASE_SERVICE_ACCOUNT` (raw JSON or base64 of it).
4. In Vercel add (Production and Preview):
   - `FIREBASE_SERVICE_ACCOUNT` (secret)
   - `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`
   - `NEXT_PUBLIC_FIREBASE_VAPID_KEY` (only if you didn't import the existing key pair)
5. Redeploy. The Notifications page's **Turn on for this device** now registers with FCM.

**Legacy Web Push.** Keep `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` set: devices that subscribed before FCM keep receiving alerts over plain Web Push (`push_subscriptions`) until they next open the app and move over, and browsers where Firebase messaging isn't supported still use it. A device is only ever notified on one channel.

**iPhone / iPad (iOS 16.4+):** Apple only allows push for web apps installed to the Home Screen. In Safari tap **Share → Add to Home Screen**, open Clock Out from the new icon, go to **Notifications → Turn on for this device**, and allow notifications. The Notifications page walks people through this.

**No on-device scheduled backup.** A web app can't schedule a local notification for later (the Notification Triggers API never shipped), so every alert is sent from the server at its exact time.

### Icons

- **Notification avatar:** `public/icon-192.png` (the app icon) is shown beside each push on Android/desktop and as the logo at the top of alert emails.
- **Status-bar badge:** `public/notification-badge.png` is a white-on-transparent clock that Android shows in the status bar.
- **iPhone:** iOS always shows the Home Screen icon (`public/apple-touch-icon.png`) on notifications; web apps can't override it.

Replace those PNGs to rebrand. Tapping a push opens the time clock (members) or that member's hours (admins).

## Credits

Clock timer time calendar Icon by Cyber Olympus on <a href="https://icon-icons.com/authors/1327-cyber-olympus">Icon-Icons.com</a>
