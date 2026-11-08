/**
 * Response headers applied to every route by `headers()` in `next.config.ts`.
 *
 * The CSP is deliberately limited to directives that cannot break the app's
 * own scripts and styles (Clerk, Vercel Analytics, Firebase, Tailwind): it
 * stops the dashboard being framed, so clock-in/out and admin delete buttons
 * cannot be clickjacked, blocks plugin and <base> based injection, and keeps
 * form submissions on this origin. A script-src needs per-request nonces and
 * allowances for Clerk, Vercel Analytics and Firebase, so it is left for a
 * separate, report-only rollout.
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

export const securityHeaders = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  { key: "Strict-Transport-Security", value: STRICT_TRANSPORT_SECURITY },
] as const;
