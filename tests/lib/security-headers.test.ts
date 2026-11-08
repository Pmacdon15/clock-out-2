// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CONTENT_SECURITY_POLICY,
  PERMISSIONS_POLICY,
  STRICT_TRANSPORT_SECURITY,
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
    ["Permissions-Policy", PERMISSIONS_POLICY],
    ["Strict-Transport-Security", STRICT_TRANSPORT_SECURITY],
  ])("sets %s", (key, value) => {
    expect(header(key)).toBe(value);
  });

  it.each([
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ])("the CSP contains %s", (directive) => {
    expect(CONTENT_SECURITY_POLICY).toContain(directive);
  });

  it("keeps geolocation on this origin and turns off the camera and mic", () => {
    expect(PERMISSIONS_POLICY).toContain("geolocation=(self)");
    expect(PERMISSIONS_POLICY).toContain("camera=()");
    expect(PERMISSIONS_POLICY).toContain("microphone=()");
  });
});
