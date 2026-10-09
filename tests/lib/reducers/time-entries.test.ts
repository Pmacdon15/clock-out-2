import { describe, expect, it } from "vitest";
import { type EntryAction, timeEntriesReducer } from "@/lib/reducers/time-entries";
import { makeEntry } from "../../utils";

describe("timeEntriesReducer", () => {
  const a = makeEntry({ id: 1 });
  const b = makeEntry({ id: 2 });

  it("ADD prepends the new entry", () => {
    const c = makeEntry({ id: 3 });
    expect(timeEntriesReducer([a, b], { type: "ADD", payload: c })).toEqual([
      c,
      a,
      b,
    ]);
  });

  it("REMOVE drops the matching entry, comparing ids as strings", () => {
    const action = {
      type: "REMOVE",
      payload: "1",
    } as unknown as EntryAction;
    expect(timeEntriesReducer([a, b], action)).toEqual([b]);
  });

  it("UPDATE merges the payload into the matching entry only", () => {
    const clockOut = new Date("2026-01-05T18:00:00Z");
    const result = timeEntriesReducer([a, b], {
      type: "UPDATE",
      payload: { id: 2, clock_out: clockOut },
    });
    expect(result[0]).toBe(a);
    expect(result[1]).toEqual({ ...b, clock_out: clockOut });
  });

  it("returns the existing state for unknown actions", () => {
    const state = [a];
    const action = { type: "NOPE" } as unknown as EntryAction;
    expect(timeEntriesReducer(state, action)).toBe(state);
  });
});
