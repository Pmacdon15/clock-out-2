/*
 * Collects Content-Security-Policy-Report-Only violations, so the stricter
 * policy in src/lib/security-headers.ts can be tuned before it's enforced.
 * Browsers send either the legacy `application/csp-report` body or Reporting
 * API batches (`application/reports+json`). Only a short summary is logged:
 * the directive, the blocked origin and the page path, never query strings.
 *
 * The endpoint is public, so it reads at most MAX_BODY_BYTES whatever the
 * Content-Length says, strips anything that could forge extra log lines, and
 * is rate limited per IP (excess reports are dropped silently).
 */

import { clientIp } from "@/lib/client-ip";
import { CSP_REPORT_LIMIT, checkRateLimit } from "@/lib/rate-limit";

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

/** Control characters (newlines included) and Unicode line separators. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** A value with every character that could break a log line removed. */
export function sanitizeForLog(value: string) {
  return value.replace(CONTROL_CHARS, "");
}

/** A CSP directive name such as "script-src-elem", or "unknown". */
export function directiveOf(value: string) {
  return /^[a-z][a-z-]{0,39}$/.test(value) ? value : "unknown";
}

/** Origin (or keyword such as "inline") without the path or query. */
export function originOf(value: string) {
  if (!value) return "unknown";
  try {
    const url = new URL(value);
    return sanitizeForLog(
      url.origin === "null" ? url.protocol.replace(/:$/, "") : url.origin,
    );
  } catch {
    // Keywords browsers send instead of a URL: "inline", "eval", "self", ...
    return /^[a-z][a-z-]{0,39}$/i.test(value) ? value : "invalid";
  }
}

/** Path of the page, without its query string or fragment. */
export function pathOf(value: string) {
  if (!value) return "unknown";
  try {
    return sanitizeForLog(new URL(value).pathname).slice(0, 120);
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
    directive: directiveOf(
      asString(r.effectiveDirective) ||
        asString(r["effective-directive"]) ||
        asString(r["violated-directive"]),
    ),
    blocked: originOf(asString(r.blockedURL) || asString(r["blocked-uri"])),
    page: pathOf(asString(r.documentURL) || asString(r["document-uri"])),
  }));
}

/**
 * The body as text, reading no more than `maxBytes` however it's sent
 * (Content-Length or chunked), or null when it's larger.
 */
export async function readCappedText(
  req: Request,
  maxBytes: number,
): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function POST(req: Request) {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  const limited = await checkRateLimit(CSP_REPORT_LIMIT, clientIp(req));
  // Over the limit: accept and drop, so a flood can't fill the logs.
  if (!limited.ok) return new Response(null, { status: 204 });

  let body: unknown = null;
  try {
    const text = await readCappedText(req, MAX_BODY_BYTES);
    if (text === null) return new Response(null, { status: 413 });
    body = JSON.parse(text);
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
