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
- **Emailed hours reports** — organizations on a plan with the Reporting feature can schedule automatic report emails (weekly, twice-monthly/pay-period, or a custom weekday every 1–2 weeks) and run ad-hoc reports for any date range.
- **MCP server** — 16 tools over Streamable HTTP with Clerk OAuth sign-in (see below).

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- [Clerk](https://clerk.com) — authentication, Organizations, Billing (plans/features), and the OAuth provider for MCP
- [Neon](https://neon.tech) serverless Postgres (`@neondatabase/serverless`)
- [Model Context Protocol](https://modelcontextprotocol.io) — `@modelcontextprotocol/server` + `mcp-handler`
- Tailwind CSS 4, Recharts, React Email + Amazon SES for report email
- Deployed on Vercel (with a Vercel Cron job for scheduled reports); Biome for lint/format; Vitest for tests

## Getting started

```bash
bun install
bun dev
```

Open http://localhost:3000. Other scripts:

```bash
bun run build        # production build
bun run test         # vitest run
bun run typecheck    # tsc --noEmit
bun run lint         # biome check --write --unsafe
bun run format       # biome format --write
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key. The MCP OAuth issuer is derived from it, so it also decides which Clerk instance issues MCP tokens. |
| `CLERK_SECRET_KEY` | Clerk secret key (used by `@clerk/nextjs`). |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Verifies Clerk webhooks at `/api/webhooks/clerk`. |
| `DATABASE_URL` | Neon Postgres connection string. |
| `NEXT_PUBLIC_APP_URL` | Public origin of the deployment (e.g. `https://clockout.patmac.ca`); used as the MCP server's website/icon origin. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | Amazon SES credentials for report email. |
| `SES_FROM_EMAIL` | From address for report email. |
| `CRON_SECRET` | Bearer secret guarding `/api/cron/weekly-report` (called daily by Vercel Cron). |

### Database

The schema lives in `schema.sql` and is applied to Neon Postgres. Tables: `time_entries` (including clock-in/out location columns), `time_entry_breaks`, `settings`, `reporting_settings`, `break_settings`, `location_settings`, `sites`. Users, organizations, memberships, and subscriptions live in Clerk, not in this database.

## MCP server

### Endpoint and discovery

```
POST https://clockout.patmac.ca/api/mcp
```

Streamable HTTP transport. The server identifies itself as `clock-out` ("Clock Out", version `1.0.0`) and sends usage instructions to clients during the `initialize` handshake.

Discovery documents (served from the app origin, CORS-open):

| URL | What it is |
| --- | --- |
| `/.well-known/oauth-protected-resource` | RFC 9728 Protected Resource Metadata: names the MCP endpoint as the resource and Clerk as its authorization server. |
| `/.well-known/oauth-authorization-server` | Clerk's OAuth authorization-server metadata, proxied from the Clerk instance for clients that look for it on the resource's own domain (2025-03-26 spec). |
| `/.well-known/openid-configuration` | Clerk's OpenID Connect discovery document, proxied the same way. |

### Connecting a client

In your AI app, add a custom MCP connector with the server URL `https://clockout.patmac.ca/api/mcp` and sign in with your Clock Out account when prompted. There is nothing to configure per client: clients register themselves with Clerk automatically (dynamic client registration or a Client ID Metadata Document), and the app's dashboard shows the same URL with a copy button (the "Connect AI (MCP Server)" card).

### Authentication

MCP uses **Clerk as an OAuth 2.0 authorization server**:

1. The client discovers Clerk from the metadata above and registers itself (DCR or CIMD).
2. The user signs in to Clock Out with Clerk and approves access.
3. Clerk issues an OAuth access token for the scopes **`profile`, `email`, `offline_access`** — nothing more is requested; the token only needs to say who signed in. `offline_access` gets the client a refresh token so it stays connected (Google/Gemini account linking requires it).
4. The client sends the token as a `Bearer` header. The server verifies it on every request with Clerk's `authenticateRequest` (`acceptsToken: "oauth_token"`) and acts as that Clerk user, with that user's organization roles.

An unauthenticated request gets a `401` with a `WWW-Authenticate` header pointing at the protected-resource metadata, per RFC 9728.

### Tools (16)

Read-only tools are marked *(read)*. Most tools accept `org_id` (an organization ID, slug, or name); with a single organization it can be omitted, and members are identified by name, email, or `user_id`. Time inputs take an IANA `timezone` (default `America/Edmonton`).

| Tool | What it does |
| --- | --- |
| `list_organizations` *(read)* | Lists the organizations the signed-in user belongs to, with `org_id`, name, slug, and their role. |
| `list_members` *(read)* | Lists an organization's members (name, email for admins, role, currently clocked in?). |
| `who_is_working` *(read)* | Who is clocked in right now, since when, and for how long — plus who is clocked out. |
| `get_clock_status` *(read)* | Whether you (or a member, for admins) are clocked in and how long the shift has run. |
| `clock_in` | Starts a shift for yourself, or for any member if you're an admin. Rejects double clock-ins and overlaps. |
| `clock_out` | Ends the active shift for yourself or (admin) any member; optional custom clock-out time. |
| `add_time_entry` | Adds one shift or a batch (`entries` array) — the tool to use when importing a photographed paper timecard or schedule. Strictly rejects overlapping shifts. |
| `list_time_entries` *(read)* | Lists shifts between `start_date` and `end_date` (default last 7 days) with durations; admins can filter by member or use `member: "all"`. |
| `get_weekly_timecard` *(read)* | Weekly timecard: totals, days worked, and day-by-day breakdowns. Supports `week_of`, explicit dates, or the month-week selector (year, month, week 1–4). |
| `export_timesheet` *(read)* | Generates PDF **and** Excel timesheets for a period (group by week/month) and returns embedded files plus signed-in download links. |
| `update_time_entry` | *(Admin)* Changes `clock_in`/`clock_out`/`hours_worked` on an existing entry, by `entry_id` or member + date. Overlap-checked. |
| `delete_time_entry` | *(Admin)* Permanently deletes a time entry by `entry_id`. |
| `manage_reporting_settings` | Views or updates the emailed-report schedule (`off`, `weekly`, `twice-monthly`, `custom` weekday every 1–2 weeks) or sends a test report. Updating requires `org:admin` and a plan with the Reporting feature. |
| `manage_break_settings` | Views or updates the lunch/break deduction: `dock_lunch` on/off, `lunch_duration_minutes`, `lunch_min_shift_hours`. Anyone can view; updating is `org:admin`. Available on every plan. |
| `run_hours_report` | *(Admin, Reporting feature)* Net hours (after break deductions) for one member or everyone between two dates, with daily breakdowns. `deliver`: return in chat (default), `email_admins`, or `both`. |
| `invite_member` | *(Admin)* Sends organization invitations by email (`action: "send"`, role `org:member` or `org:admin`), lists pending invitations (`"list"`), or revokes one (`"revoke"`). |

Rules the server enforces and tells clients about: never create duplicate/overlapping shifts (edit the existing entry instead); only edit/delete when the user explicitly asks; report hours are net of break deductions; exporting always returns both the PDF and spreadsheet links.

Location capture and geofencing are web-app features — the browser supplies the coordinates at punch time — so the MCP tools take no location input.

### Roles & permissions

- **Members** (`org:member`): clock themselves in/out, manage their own shifts, view their own entries/timecards, and see who is working.
- **Admins** (`org:admin`): everything above for every member, plus invites, entry edit/delete for anyone, break settings, and — with the Reporting plan feature — reporting settings and hours reports.

## Clerk setup

Clock Out leans on Clerk for more than sign-in. Everything a fresh Clerk instance needs turned on — in the Clerk Dashboard for the production instance — is in this one table:

| # | Clerk setting | Exact value | Used for |
| --- | --- | --- | --- |
| 1 | Organizations | Enabled, with the built-in roles `org:admin` and `org:member` | The app is multi-tenant on Clerk orgs; memberships, organization invitations (web UI and the MCP `invite_member` tool), and every admin-only check depend on it |
| 2 | Billing | Clerk Billing enabled, with organization subscription plans | Organizations subscribe to plans; the plan features below are attached to plans and checked with `has({ feature: … })` |
| 3 | Billing feature | **`reporting`** | Report scheduling and running — gated by `has({ feature: "reporting" })`, including the MCP tools `manage_reporting_settings` and `run_hours_report`. Plans without it can still use everything else, including break settings |
| 4 | Billing feature | **`geofencing`** | Location capture, job sites, and geofenced clock-in — gated by `has({ feature: "geofencing" })` |
| 5 | Billing feature | **`download_graph`** | Downloading the hours charts on the View Hours page — gated by `has({ feature: "download_graph" })` |
| 6 | OAuth provider | Clerk enabled as an OAuth 2.0 authorization server | MCP clients (Claude, ChatGPT, Gemini, …) sign users in and receive access tokens the API verifies |
| 7 | OAuth provider setting | **Dynamic Client Registration (DCR)** — on | MCP clients register themselves at `/oauth/register` instead of being created by hand |
| 8 | OAuth provider setting | **Client ID Metadata Documents (CIMD)** — on | The other registration route some MCP clients use |
| 9 | OAuth scopes | **`profile`**, **`email`**, **`offline_access`** grantable to registered clients | The scopes the MCP server requests. `offline_access` matters: without it clients get no refresh token and keep dropping the connection (Gemini account linking fails outright). No per-client setup is needed or wanted — don't create manual OAuth applications for MCP clients |
| 10 | Webhook endpoint | `https://<your-domain>/api/webhooks/clerk` | Receives Clerk events at `/api/webhooks/clerk`; its signing secret goes in `CLERK_WEBHOOK_SIGNING_SECRET` |
| 11 | Webhook event | **`subscriptionItem.active`** (the only event the code handles) | How the app learns an organization's current plan |
| 12 | Production instance + custom domain | Instance Frontend API domain `https://clerk.clockout.patmac.ca` | The MCP OAuth issuer is derived from the publishable key; MCP discovery, token verification, and every client's stored connection key off that issuer |
| 13 | Sign-in methods | Email/password and/or social, under User & Authentication | Normal user sign-in to the web app; MCP sign-in rides on the same Clerk sign-in |

App-side, Clerk is wired in through `src/proxy.ts` (`clerkMiddleware`, protecting `/dashboard(.*)`) and `@clerk/nextjs` providers; no JWT templates or custom session claims are used — MCP token verification is done by Clerk's `authenticateRequest`, not by checking JWT claims in app code.

## Deployment

Deployed on Vercel. `vercel.json` registers a daily cron (`0 6 * * *`) hitting `/api/cron/weekly-report`, which sends any scheduled report emails that are due; the route requires the `CRON_SECRET` bearer token. Email goes out through Amazon SES using React Email templates.

## Credits

Clock timer time calendar Icon by Cyber Olympus on <a href="https://icon-icons.com/authors/1327-cyber-olympus">Icon-Icons.com</a>
