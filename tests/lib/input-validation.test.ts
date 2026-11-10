import { describe, expect, it } from "vitest";
import {
  invalidSiteTextReason,
  isWithinRecordedWindow,
  MAX_SITE_ADDRESS_LENGTH,
  MAX_SITE_NAME_LENGTH,
  parseClientDate,
  reportingSettingsSchema,
} from "@/lib/input-validation";

describe("reportingSettingsSchema", () => {
  it.each([
    { frequency: "weekly", day: null, interval: 1 },
    { frequency: "custom", day: "Friday", interval: 2 },
    { frequency: "bi-weekly", day: "Monday", interval: 2 },
    { frequency: "biweekly", day: "Monday", interval: 2 },
    { frequency: "off", day: null, interval: 1 },
  ])("accepts %o", (input) => {
    expect(reportingSettingsSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    { frequency: "x".repeat(10_000), day: null, interval: 1 },
    { frequency: "weekly", day: "Funday", interval: 1 },
    { frequency: "weekly", day: null, interval: 3 },
    { frequency: "weekly", day: null, interval: 1.5 },
    { frequency: { toString: () => "weekly" }, day: null, interval: 1 },
  ])("rejects %o", (input) => {
    expect(reportingSettingsSchema.safeParse(input).success).toBe(false);
  });
});

describe("invalidSiteTextReason", () => {
  it("accepts a normal name and optional address", () => {
    expect(invalidSiteTextReason("Main Office", undefined)).toBeNull();
    expect(invalidSiteTextReason("Main Office", null)).toBeNull();
    expect(invalidSiteTextReason("Main Office", "1 Main St")).toBeNull();
  });

  it.each([
    ["an empty name", "  ", undefined],
    ["a non-string name", { trim: 1 }, undefined],
    ["an oversized name", "a".repeat(MAX_SITE_NAME_LENGTH + 1), undefined],
    ["a non-string address", "Office", 42],
    ["an oversized address", "Office", "a".repeat(MAX_SITE_ADDRESS_LENGTH + 1)],
  ])("rejects %s", (_label, name, address) => {
    expect(invalidSiteTextReason(name, address)).not.toBeNull();
  });
});

describe("isWithinRecordedWindow", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  it.each([
    ["2000-01-01T00:00:00Z", true],
    ["2026-06-01T11:00:00Z", true],
    ["2026-06-07T12:00:00Z", true],
    ["1999-12-31T23:59:59Z", false],
    ["2026-06-09T12:00:00Z", false],
    ["9999-01-01T00:00:00Z", false],
  ])("%s -> %s", (iso, expected) => {
    expect(isWithinRecordedWindow(new Date(iso), now)).toBe(expected);
  });

  it("rejects an invalid date", () => {
    expect(isWithinRecordedWindow(new Date("nope"), now)).toBe(false);
  });
});

describe("parseClientDate", () => {
  it("parses an ISO string", () => {
    expect(parseClientDate("2026-01-01T00:00:00Z")?.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it.each([[""], ["not a date"], [123], [{}], [null], ["x".repeat(65)]])(
    "returns null for %o",
    (value) => {
      expect(parseClientDate(value)).toBeNull();
    },
  );
});
