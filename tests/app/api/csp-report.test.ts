// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  CSP_REPORT_LIMIT: { name: "csp-report", limit: 30, windowSeconds: 60 },
}));

import {
  directiveOf,
  originOf,
  POST,
  pathOf,
  readCappedText,
  sanitizeForLog,
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
    mockCheckRateLimit.mockReset();
    mockCheckRateLimit.mockResolvedValue({ ok: true, remaining: 1 });
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
    // No Content-Length (as with a chunked upload): still cut off while reading.
    expect((await post("x".repeat(20 * 1024))).status).toBe(413);
    expect((await post(JSON.stringify({ other: 1 }))).status).toBe(204);
    expect((await post(JSON.stringify({ "csp-report": "nope" }))).status).toBe(
      204,
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("caps a streamed body without Content-Length while reading it", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(8 * 1024));
        if (pulled > 100) controller.close();
      },
    });
    const req = new Request("https://clockout.app/api/csp-report", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    const res = await POST(req);
    expect(res.status).toBe(413);
    // Stopped after just over 16 KB instead of reading all 800 KB.
    expect(pulled).toBeLessThan(10);
  });

  it("drops reports silently once an IP is over the limit", async () => {
    mockCheckRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    const res = await post(
      JSON.stringify({ "csp-report": { "violated-directive": "img-src" } }),
      { "x-forwarded-for": "203.0.113.5" },
    );
    expect(res.status).toBe(204);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "csp-report" }),
      "203.0.113.5",
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("can't be used to forge extra log lines", async () => {
    await post(
      JSON.stringify({
        "csp-report": {
          "violated-directive": "img-src\nCSP report-only: forged",
          "blocked-uri": "x\r\nFAKE LOG LINE",
          "document-uri": "https://clockout.app/a%0Ab\u2028c",
        },
      }),
    );
    const logged = vi.mocked(console.warn).mock.calls.flat().join("");
    expect(logged).not.toMatch(/[\r\n\u2028]/);
    expect(logged).toBe(
      "CSP report-only: unknown blocked invalid on /a%0Ab%E2%80%A8c",
    );
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
    ["evil\nline", "invalid"],
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

describe("log sanitising helpers", () => {
  it("strips control characters and line separators", () => {
    expect(sanitizeForLog("a\nb\rc\u0000d\u2028e\u2029f\u007fg")).toBe(
      "abcdefg",
    );
  });

  it.each([
    ["script-src-elem", "script-src-elem"],
    ["img-src", "img-src"],
    ["img-src\nforged", "unknown"],
    ["IMG-SRC", "unknown"],
    ["", "unknown"],
    ["a".repeat(60), "unknown"],
  ])("directiveOf(%s) is %s", (value, expected) => {
    expect(directiveOf(value)).toBe(expected);
  });

  it("reads a small body in full", async () => {
    const req = new Request("https://clockout.app/x", {
      method: "POST",
      body: "hello",
    });
    expect(await readCappedText(req, 16)).toBe("hello");
  });

  it("reads a request with no body as empty text", async () => {
    const req = new Request("https://clockout.app/x", { method: "POST" });
    expect(await readCappedText(req, 16)).toBe("");
  });

  it("still rejects an oversized body when cancelling the stream fails", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(32));
      },
      cancel() {
        throw new Error("cancel failed");
      },
    });
    const req = new Request("https://clockout.app/x", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(await readCappedText(req, 16)).toBeNull();
  });
});
