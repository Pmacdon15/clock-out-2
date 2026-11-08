// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  originOf,
  POST,
  pathOf,
  violationsFrom,
} from "@/app/api/csp-report/route";

const post = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://clockout.app/api/csp-report", {
      method: "POST",
      headers,
      body,
    }),
  );

describe("POST /api/csp-report", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("logs a legacy report without query strings", async () => {
    const res = await post(
      JSON.stringify({
        "csp-report": {
          "document-uri": "https://clockout.app/hours?member=secret",
          "violated-directive": "script-src-elem",
          "blocked-uri": "https://evil.example/x.js?token=abc",
        },
      }),
    );
    expect(res.status).toBe(204);
    expect(console.warn).toHaveBeenCalledWith(
      "CSP report-only: script-src-elem blocked https://evil.example on /hours",
    );
    const logged = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(logged).not.toContain("secret");
    expect(logged).not.toContain("token");
  });

  it("logs each csp-violation in a Reporting API batch", async () => {
    const res = await post(
      JSON.stringify([
        {
          type: "csp-violation",
          body: {
            documentURL: "https://clockout.app/",
            effectiveDirective: "connect-src",
            blockedURL: "https://api.example/x",
          },
        },
        { type: "deprecation", body: {} },
        { type: "csp-violation", body: { blockedURL: "inline" } },
        null,
      ]),
    );
    expect(res.status).toBe(204);
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(
      "CSP report-only: connect-src blocked https://api.example on /",
    );
    expect(console.warn).toHaveBeenCalledWith(
      "CSP report-only: unknown blocked inline on unknown",
    );
  });

  it("refuses an oversized body and ignores junk", async () => {
    expect(
      (await post("{}", { "content-length": String(64 * 1024) })).status,
    ).toBe(413);
    expect((await post("not json")).status).toBe(204);
    expect((await post("x".repeat(20 * 1024))).status).toBe(204);
    expect((await post(JSON.stringify({ other: 1 }))).status).toBe(204);
    expect((await post(JSON.stringify({ "csp-report": "nope" }))).status).toBe(
      204,
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("logs at most ten reports per batch", () => {
    const batch = Array.from({ length: 25 }, () => ({
      type: "csp-violation",
      body: { effectiveDirective: "img-src" },
    }));
    expect(violationsFrom(batch)).toHaveLength(10);
  });
});

describe("report helpers", () => {
  it.each([
    ["https://a.example/p?q=1", "https://a.example"],
    ["data:image/png;base64,AAA", "data"],
    ["inline", "inline"],
    ["", "unknown"],
  ])("originOf(%s) is %s", (value, origin) => {
    expect(originOf(value)).toBe(origin);
  });

  it.each([
    ["https://a.example/p/q?x=1#f", "/p/q"],
    ["not a url", "unknown"],
    ["", "unknown"],
  ])("pathOf(%s) is %s", (value, path) => {
    expect(pathOf(value)).toBe(path);
  });
});
