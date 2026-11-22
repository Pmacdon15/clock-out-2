import { describe, expect, it } from "vitest";
import {
  ARRIVAL_PROMPT_COOLDOWN_MS,
  arrivalAlertKey,
  arrivalPromptMessage,
  isArrivalPromptEnabled,
  isPreciseEnough,
  MAX_ARRIVAL_ACCURACY_METERS,
  trackArrival,
} from "@/lib/arrival";

// Two sites ~1.1 km apart, 150 m radius each.
const siteA = {
  id: 1,
  name: "Site A",
  latitude: 45.0,
  longitude: -75.0,
  radius_meters: 150,
};
const siteB = {
  id: 2,
  name: "Site B",
  latitude: 45.01,
  longitude: -75.0,
  radius_meters: 150,
};
const sites = [siteA, siteB];

const atA = { latitude: 45.0, longitude: -75.0, accuracy: 20 };
const atB = { latitude: 45.01, longitude: -75.0, accuracy: 20 };
const between = { latitude: 45.005, longitude: -75.0, accuracy: 20 };

describe("isArrivalPromptEnabled", () => {
  it("is on only when the org switched it on", () => {
    expect(isArrivalPromptEnabled({ arrival_prompts: true })).toBe(true);
    expect(isArrivalPromptEnabled({ arrival_prompts: false })).toBe(false);
    expect(isArrivalPromptEnabled({})).toBe(false);
    expect(isArrivalPromptEnabled(null)).toBe(false);
    expect(isArrivalPromptEnabled(undefined)).toBe(false);
  });
});

describe("isPreciseEnough", () => {
  it("accepts a fix with no accuracy, or one within the limit", () => {
    expect(isPreciseEnough({ latitude: 1, longitude: 1 })).toBe(true);
    expect(isPreciseEnough({ latitude: 1, longitude: 1, accuracy: null })).toBe(
      true,
    );
    expect(
      isPreciseEnough({ latitude: 1, longitude: 1, accuracy: Number.NaN }),
    ).toBe(true);
    expect(
      isPreciseEnough({
        latitude: 1,
        longitude: 1,
        accuracy: MAX_ARRIVAL_ACCURACY_METERS,
      }),
    ).toBe(true);
  });

  it("rejects a vague fix and invalid coordinates", () => {
    expect(
      isPreciseEnough({
        latitude: 1,
        longitude: 1,
        accuracy: MAX_ARRIVAL_ACCURACY_METERS + 1,
      }),
    ).toBe(false);
    expect(isPreciseEnough({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isPreciseEnough(null)).toBe(false);
  });
});

describe("arrivalAlertKey", () => {
  it("is the same within a cooldown window and changes after it", () => {
    const base = { userId: "u1", orgId: "o1", siteId: 7 };
    const t0 = new Date(ARRIVAL_PROMPT_COOLDOWN_MS * 100);
    const later = new Date(t0.getTime() + ARRIVAL_PROMPT_COOLDOWN_MS - 1);
    const next = new Date(t0.getTime() + ARRIVAL_PROMPT_COOLDOWN_MS);
    expect(arrivalAlertKey({ ...base, now: t0 })).toBe("arrival:o1:u1:7:100");
    expect(arrivalAlertKey({ ...base, now: later })).toBe(
      arrivalAlertKey({ ...base, now: t0 }),
    );
    expect(arrivalAlertKey({ ...base, now: next })).toBe("arrival:o1:u1:7:101");
  });
});

describe("arrivalPromptMessage", () => {
  it("asks to clock in and opens the org's time clock", () => {
    expect(
      arrivalPromptMessage({ siteName: "Site A", orgId: "org 1" }),
    ).toEqual({
      title: "Clock in?",
      body: "You've arrived at Site A. Clock in?",
      url: "/?orgId=org%201",
      tag: "arrival:org 1",
    });
  });
});

describe("trackArrival", () => {
  it("counts a first fix inside a site as an arrival", () => {
    expect(trackArrival(undefined, atA, sites)).toEqual({
      insideSiteId: 1,
      arrivedAt: siteA,
    });
  });

  it("does not repeat while the member stays at the site", () => {
    expect(trackArrival(1, atA, sites)).toEqual({
      insideSiteId: 1,
      arrivedAt: null,
    });
  });

  it("notes leaving, then arriving again", () => {
    const left = trackArrival(1, between, sites);
    expect(left).toEqual({ insideSiteId: null, arrivedAt: null });
    expect(trackArrival(left.insideSiteId, atA, sites).arrivedAt).toBe(siteA);
  });

  it("treats moving straight to another site as an arrival there", () => {
    expect(trackArrival(1, atB, sites)).toEqual({
      insideSiteId: 2,
      arrivedAt: siteB,
    });
  });

  it("ignores vague or missing fixes without changing state", () => {
    expect(trackArrival(null, { ...atA, accuracy: 5_000 }, sites)).toEqual({
      insideSiteId: null,
      arrivedAt: null,
    });
    expect(trackArrival(1, null, sites)).toEqual({
      insideSiteId: 1,
      arrivedAt: null,
    });
  });

  it("reports nothing with no sites", () => {
    expect(trackArrival(undefined, atA, [])).toEqual({
      insideSiteId: null,
      arrivedAt: null,
    });
  });
});
