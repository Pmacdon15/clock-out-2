/**
 * Response headers applied to every route by `headers()` in `next.config.ts`.
 *
 * The CSP is deliberately limited to directives that cannot break the app's
 * own scripts and styles (Clerk, Vercel Analytics, Tailwind): it stops the
 * dashboard being framed, so clock-in/out and admin delete buttons cannot be
 * clickjacked, and blocks plugin and <base> based injection.
 */
export const CONTENT_SECURITY_POLICY = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

export const securityHeaders = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
] as const;
