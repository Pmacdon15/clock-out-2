import { describe, expect, it } from "vitest";
import {
  failedJob,
  type Job,
  jobSelectionParam,
  MAX_JOB_SELECTION,
  parseJobSelection,
  selectJobs,
  summarizeJob,
} from "@/lib/jobs";
import type { TimeEntry } from "@/lib/types";

const jobs: Job[] = [
  { orgId: "a", name: "Acme", isAdmin: true },
  { orgId: "b", name: "Bakery", isAdmin: false },
];

const entry = (
  id: number,
  userId: string,
  clockIn: string,
  clockOut: string | null,
) =>
  ({
    id,
    user_id: userId,
    org_id: "a",
    clock_in: clockIn,
    clock_out: clockOut,
  }) as unknown as TimeEntry;

describe("parseJobSelection", () => {
  it.each([[undefined], [""], ["all"], [" , ,"]])(
    "treats %o as every job",
    (raw) => {
      expect(parseJobSelection(raw)).toBe("all");
    },
  );

  it("splits, trims and de-duplicates ids", () => {
    expect(parseJobSelection(" a,b ,a,,c")).toEqual(["a", "b", "c"]);
  });

  it("caps how many ids it reads", () => {
    const raw = Array.from({ length: 500 }, (_, i) => `org_${i}`).join(",");
    expect(parseJobSelection(raw)).toHaveLength(MAX_JOB_SELECTION);
  });
});

describe("selectJobs", () => {
  it("keeps only the caller's jobs, in their order", () => {
    expect(selectJobs(jobs, "all")).toBe(jobs);
    expect(selectJobs(jobs, ["b", "stranger", "a"])).toEqual(jobs);
    expect(selectJobs(jobs, ["stranger"])).toEqual([]);
  });
});

describe("jobSelectionParam", () => {
  it("omits the param for all or none, and lists a subset", () => {
    expect(jobSelectionParam(jobs, ["a", "b"])).toBeNull();
    expect(jobSelectionParam(jobs, [])).toBeNull();
    expect(jobSelectionParam(jobs, ["b"])).toBe("b");
  });
});

describe("summarizeJob", () => {
  it("totals by member, rounds, and lists the newest shift first", () => {
    const nowMs = Date.parse("2026-03-03T10:00:00Z");
    const summary = summarizeJob(
      jobs[0] as Job,
      [
        entry(1, "u1", "2026-03-01T09:00:00Z", "2026-03-01T09:20:00Z"),
        entry(2, "u2", "2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z"),
        entry(3, "u1", "2026-03-03T09:00:00Z", null),
        entry(4, "u3", "2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z"),
      ],
      null,
      (id) => ({ u1: "Ann", u2: "Zed", u3: "Bea" })[id] ?? id,
      nowMs,
    );

    expect(summary).toMatchObject({
      orgId: "a",
      isAdmin: true,
      shifts: 4,
      totalHours: 3.33,
    });
    expect(summary.members).toEqual([
      { userId: "u1", name: "Ann", hours: 1.33, shifts: 2 },
      { userId: "u3", name: "Bea", hours: 1, shifts: 1 },
      { userId: "u2", name: "Zed", hours: 1, shifts: 1 },
    ]);
    expect(summary.entries.map((e) => e.id)).toEqual([3, 2, 4, 1]);
    expect(summary.entries[0]).toEqual({
      id: 3,
      userId: "u1",
      memberName: "Ann",
      clockIn: "2026-03-03T09:00:00.000Z",
      clockOut: null,
      hours: 1,
    });
    expect(summary.entries[3]?.hours).toBe(0.33);
  });

  it("uses the current time for an open shift by default", () => {
    const summary = summarizeJob(
      jobs[1] as Job,
      [entry(1, "me", new Date(Date.now() - 3_600_000).toISOString(), null)],
      null,
      () => "You",
    );
    expect(summary.totalHours).toBeCloseTo(1, 1);
  });
});

describe("failedJob", () => {
  it("is an empty job with the reason", () => {
    expect(failedJob(jobs[1] as Job, "nope")).toEqual({
      ...jobs[1],
      totalHours: 0,
      shifts: 0,
      members: [],
      entries: [],
      error: "nope",
    });
  });
});
