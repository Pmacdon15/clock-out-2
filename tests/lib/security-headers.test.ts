// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CONTENT_SECURITY_POLICY,
  securityHeaders,
} from "@/lib/security-headers";

const header = (key: string) =>
  securityHeaders.find((h) => h.key === key)?.value;

describe("securityHeaders", () => {
  it.each([
    ["Content-Security-Policy", CONTENT_SECURITY_POLICY],
    ["X-Frame-Options", "DENY"],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ])("sets %s", (key, value) => {
    expect(header(key)).toBe(value);
  });

  it.each(["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'"])(
    "the CSP contains %s",
    (directive) => {
      expect(CONTENT_SECURITY_POLICY).toContain(directive);
    },
  );
});
