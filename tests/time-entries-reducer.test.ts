import { describe, expect, test } from "bun:test";
import { timeEntriesReducer } from "@/lib/reducers/time-entries";
import type { TimeEntry } from "@/lib/types";

const entry = (id: number, overrides: Partial<TimeEntry> = {}): TimeEntry => ({
  id,
  user_id: "user_1",
  org_id: "org_1",
  clock_in: new Date("2026-10-01T09:00:00Z"),
  clock_out: null,
  created_at: new Date("2026-10-01T09:00:00Z"),
  updated_at: new Date("2026-10-01T09:00:00Z"),
  ...overrides,
});

describe("timeEntriesReducer", () => {
  test("ADD puts the new entry first", () => {
    const state = [entry(1), entry(2)];
    const result = timeEntriesReducer(state, { type: "ADD", payload: entry(3) });
    expect(result.map((e) => e.id)).toEqual([3, 1, 2]);
  });

  test("REMOVE drops the matching entry", () => {
    const state = [entry(1), entry(2), entry(3)];
    const result = timeEntriesReducer(state, { type: "REMOVE", payload: 2 });
    expect(result.map((e) => e.id)).toEqual([1, 3]);
  });

  test("REMOVE matches ids given as strings", () => {
    const state = [entry(1), entry(2)];
    const result = timeEntriesReducer(state, {
      type: "REMOVE",
      payload: "2" as unknown as number,
    });
    expect(result.map((e) => e.id)).toEqual([1]);
  });

  test("REMOVE with an unknown id leaves entries unchanged", () => {
    const state = [entry(1)];
    expect(timeEntriesReducer(state, { type: "REMOVE", payload: 99 })).toEqual(
      state,
    );
  });

  test("UPDATE merges fields into the matching entry only", () => {
    const clockOut = new Date("2026-10-01T17:00:00Z");
    const state = [entry(1), entry(2)];
    const result = timeEntriesReducer(state, {
      type: "UPDATE",
      payload: { id: 2, clock_out: clockOut },
    });
    expect(result[0]).toEqual(state[0]);
    expect(result[1]).toEqual({ ...state[1], clock_out: clockOut });
  });

  test("does not mutate the previous state", () => {
    const state = [entry(1)];
    const snapshot = structuredClone(state);
    timeEntriesReducer(state, { type: "ADD", payload: entry(2) });
    timeEntriesReducer(state, {
      type: "UPDATE",
      payload: { id: 1, clock_out: new Date() },
    });
    timeEntriesReducer(state, { type: "REMOVE", payload: 1 });
    expect(state).toEqual(snapshot);
  });

  test("unknown actions return the same state", () => {
    const state = [entry(1)];
    const result = timeEntriesReducer(state, {
      type: "NOPE",
    } as unknown as Parameters<typeof timeEntriesReducer>[1]);
    expect(result).toBe(state);
  });
});
