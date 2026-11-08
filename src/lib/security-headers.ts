import { configuredIssuer } from "../mcp/oauth-config";

/**
 * Response headers applied to every route by `headers()` in `next.config.ts`.
 *
 * The CSP is deliberately limited to directives that cannot break the app's
 * own scripts and styles (Clerk, Vercel Analytics, Firebase, Tailwind): it
 * stops the dashboard being framed, so clock-in/out and admin delete buttons
 * cannot be clickjacked, blocks plugin and <base> based injection, and keeps
 * form submissions on this origin. The stricter policy, with script, style,
 * connect and frame sources, is sent report-only (below) until its reports
 * show it doesn't block anything the app needs.
 */
export const CONTENT_SECURITY_POLICY = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

/**
 * Browser features the app may use: geolocation for clock-in location on
 * this origin only; no camera, microphone or payment APIs anywhere.
 */
export const PERMISSIONS_POLICY = [
  "geolocation=(self)",
  "camera=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

/** Two years of HTTPS-only, so the app doesn't rely on its host adding it. */
export const STRICT_TRANSPORT_SECURITY = "max-age=63072000; includeSubDomains";

/** Where browsers send CSP violation reports (src/app/api/csp-report). */
export const CSP_REPORT_PATH = "/api/csp-report";

/**
 * The full policy, sent as Content-Security-Policy-Report-Only so violations
 * are reported without blocking anything. Nonces would force every page to
 * render dynamically, which Partial Prerendering (cacheComponents) doesn't
 * allow, so scripts are limited by origin: this app, Clerk's Frontend API,
 * Cloudflare Turnstile (Clerk's bot check) and Vercel Analytics; inline
 * scripts stay allowed for the React Server Components payload.
 */
export function reportOnlyPolicy(clerkOrigin: string | null) {
  const clerk = clerkOrigin ? [clerkOrigin] : [];
  return [
    "default-src 'self'",
    [
      "script-src 'self' 'unsafe-inline'",
      ...clerk,
      "https://challenges.cloudflare.com",
      "https://va.vercel-scripts.com",
    ].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://img.clerk.com",
    "font-src 'self' data:",
    [
      "connect-src 'self'",
      ...clerk,
      "https://firebaseinstallations.googleapis.com",
      "https://fcmregistrations.googleapis.com",
    ].join(" "),
    ["frame-src 'self'", ...clerk, "https://challenges.cloudflare.com"].join(
      " ",
    ),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
    "report-to csp-endpoint",
  ].join("; ");
}

export const CONTENT_SECURITY_POLICY_REPORT_ONLY = reportOnlyPolicy(
  configuredIssuer(),
);

export const securityHeaders = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  { key: "Strict-Transport-Security", value: STRICT_TRANSPORT_SECURITY },
  {
    key: "Content-Security-Policy-Report-Only",
    value: CONTENT_SECURITY_POLICY_REPORT_ONLY,
  },
  { key: "Reporting-Endpoints", value: `csp-endpoint="${CSP_REPORT_PATH}"` },
] as const;
