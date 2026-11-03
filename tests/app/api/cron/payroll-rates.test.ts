// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ syncPayrollRatesFromCra: vi.fn() }));

vi.mock("@/lib/payroll-dal", () => ({
  syncPayrollRatesFromCra: mocks.syncPayrollRatesFromCra,
}));

import { GET } from "@/app/api/cron/payroll-rates/route";

const cronRequest = (auth?: string) =>
  new Request("https://example.test/api/cron/payroll-rates", {
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/cron/payroll-rates", () => {
  it("rejects requests without the cron secret", async () => {
    const response = await GET(cronRequest("Bearer wrong"));
    expect(response.status).toBe(401);
    expect(mocks.syncPayrollRatesFromCra).not.toHaveBeenCalled();
  });

  it("syncs the CRA rates and reports what changed", async () => {
    const result = {
      source: "https://cra.example",
      updated: ["CA@2027-01-01"],
      unchanged: [],
      rejected: [],
    };
    mocks.syncPayrollRatesFromCra.mockResolvedValue(result);
    const response = await GET(cronRequest("Bearer s3cret"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(result);
  });

  it("keeps the existing rates when the update fails", async () => {
    mocks.syncPayrollRatesFromCra.mockRejectedValue(new Error("layout"));
    const response = await GET(cronRequest("Bearer s3cret"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Payroll rates update failed; existing rates kept",
    });
  });
});
