/*
 * Collects Content-Security-Policy-Report-Only violations, so the stricter
 * policy in src/lib/security-headers.ts can be tuned before it's enforced.
 * Browsers send either the legacy `application/csp-report` body or Reporting
 * API batches (`application/reports+json`). Only a short summary is logged:
 * the directive, the blocked origin and the page path, never query strings.
 */

/** Largest body read; a real report is a few hundred bytes. */
const MAX_BODY_BYTES = 16 * 1024;
/** Most reports logged from one batch. */
const MAX_REPORTS = 10;

type Violation = {
  directive: string;
  blocked: string;
  page: string;
};

const asString = (value: unknown) =>
  typeof value === "string" ? value.slice(0, 200) : "";

/** Origin (or keyword such as "inline") without the path or query. */
export function originOf(value: string) {
  if (!value) return "unknown";
  try {
    const url = new URL(value);
    return url.origin === "null" ? url.protocol.replace(/:$/, "") : url.origin;
  } catch {
    return value.slice(0, 40);
  }
}

/** Path of the page, without its query string or fragment. */
export function pathOf(value: string) {
  if (!value) return "unknown";
  try {
    return new URL(value).pathname.slice(0, 120);
  } catch {
    return "unknown";
  }
}

/** The violations in a legacy report or a Reporting API batch. */
export function violationsFrom(body: unknown): Violation[] {
  const items: Record<string, unknown>[] = [];
  if (Array.isArray(body)) {
    for (const entry of body) {
      const report = (entry as { type?: unknown; body?: unknown } | null) ?? {};
      if (report.type === "csp-violation" && report.body) {
        items.push(report.body as Record<string, unknown>);
      }
    }
  } else if (body && typeof body === "object" && "csp-report" in body) {
    const legacy = (body as Record<string, unknown>)["csp-report"];
    if (legacy && typeof legacy === "object") {
      items.push(legacy as Record<string, unknown>);
    }
  }
  return items.slice(0, MAX_REPORTS).map((r) => ({
    directive:
      asString(r.effectiveDirective) ||
      asString(r["effective-directive"]) ||
      asString(r["violated-directive"]) ||
      "unknown",
    blocked: originOf(asString(r.blockedURL) || asString(r["blocked-uri"])),
    page: pathOf(asString(r.documentURL) || asString(r["document-uri"])),
  }));
}

export async function POST(req: Request) {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
  let body: unknown = null;
  try {
    const text = await req.text();
    if (text.length <= MAX_BODY_BYTES) body = JSON.parse(text);
  } catch {
    body = null;
  }
  for (const v of violationsFrom(body)) {
    console.warn(
      `CSP report-only: ${v.directive} blocked ${v.blocked} on ${v.page}`,
    );
  }
  return new Response(null, { status: 204 });
}
