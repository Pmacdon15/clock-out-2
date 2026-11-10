// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY_REPORT_ONLY,
  CSP_REPORT_PATH,
  enforcedDirectiveNames,
  enforcedPolicy,
  PERMISSIONS_POLICY,
  reportOnlyPolicy,
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

  it("sends the stricter policy report-only, with a report endpoint", () => {
    expect(header("Content-Security-Policy-Report-Only")).toBe(
      CONTENT_SECURITY_POLICY_REPORT_ONLY,
    );
    expect(header("Reporting-Endpoints")).toBe(
      `csp-endpoint="${CSP_REPORT_PATH}"`,
    );
  });

  it("limits scripts, connections and frames to known origins", () => {
    const policy = reportOnlyPolicy("https://clerk.clockout.patmac.ca");
    const directive = (name: string) =>
      policy.split("; ").find((d) => d.startsWith(`${name} `));
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(directive("script-src")).toContain(
      "https://clerk.clockout.patmac.ca",
    );
    expect(directive("script-src")).toContain("https://va.vercel-scripts.com");
    expect(directive("connect-src")).toContain(
      "https://fcmregistrations.googleapis.com",
    );
    expect(directive("frame-src")).toContain(
      "https://challenges.cloudflare.com",
    );
    expect(policy).toContain(`report-uri ${CSP_REPORT_PATH}`);
    expect(policy).toContain("report-to csp-endpoint");
  });

  it("leaves Clerk out when no publishable key is configured", () => {
    const policy = reportOnlyPolicy(null);
    expect(policy).toContain(
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://va.vercel-scripts.com;",
    );
    expect(policy).toContain(
      "frame-src 'self' https://challenges.cloudflare.com;",
    );
  });
});

describe("promoting report-only directives to enforced", () => {
  const reportOnly = reportOnlyPolicy("https://clerk.example.com");

  it("enforces only the base directives by default", () => {
    expect(enforcedDirectiveNames(undefined)).toEqual([]);
    expect(enforcedPolicy(reportOnly, [])).toBe(
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
    );
  });

  it("parses CSP_ENFORCE_DIRECTIVES and ignores unknown or reporting names", () => {
    expect(
      enforcedDirectiveNames(
        " IMG-SRC, frame-src connect-src,img-src,bogus,report-uri",
      ),
    ).toEqual(["img-src", "frame-src", "connect-src"]);
  });

  it("copies the promoted directives from the report-only policy", () => {
    const policy = enforcedPolicy(reportOnly, ["img-src", "connect-src"]);
    expect(policy).toContain(
      "img-src 'self' data: blob: https://img.clerk.com",
    );
    expect(policy).toContain("connect-src 'self' https://clerk.example.com");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("script-src");
    expect(policy).not.toContain("report-uri");
  });
});
