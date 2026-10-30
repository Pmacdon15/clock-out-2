// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

const cronRequest = (auth?: string) =>
  new Request("https://example.test/api/cron/weekly-report", {
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
});

describe("isAuthorizedCronRequest", () => {
  it("accepts the configured bearer secret", () => {
    expect(isAuthorizedCronRequest(cronRequest("Bearer cron-secret"))).toBe(
      true,
    );
  });

  it.each([
    ["a wrong secret", "Bearer nope"],
    ["a secret of a different length", "Bearer cron-secret-longer"],
    ["the bare secret without the scheme", "cron-secret"],
    ["the literal string undefined", "Bearer undefined"],
  ])("rejects %s", (_label, auth) => {
    expect(isAuthorizedCronRequest(cronRequest(auth))).toBe(false);
  });

  it("rejects a request with no authorization header", () => {
    expect(isAuthorizedCronRequest(cronRequest())).toBe(false);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("rejects every request when CRON_SECRET is %s", (_label, secret) => {
    if (secret === undefined) delete process.env.CRON_SECRET;
    else vi.stubEnv("CRON_SECRET", secret);
    expect(isAuthorizedCronRequest(cronRequest("Bearer cron-secret"))).toBe(
      false,
    );
    expect(isAuthorizedCronRequest(cronRequest("Bearer undefined"))).toBe(
      false,
    );
  });
});
