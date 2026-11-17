import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  userMemberships: vi.fn(),
  orgMemberships: vi.fn(),
  dbGetTimeEntries: vi.fn(),
  dbGetOrgTimeEntries: vi.fn(),
  dbGetBreakSettings: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: { protect: mocks.protect },
  clerkClient: vi.fn(async () => ({
    users: { getOrganizationMembershipList: mocks.userMemberships },
    organizations: { getOrganizationMembershipList: mocks.orgMemberships },
  })),
}));

vi.mock("@/lib/db", () => ({
  dbGetTimeEntries: mocks.dbGetTimeEntries,
  dbGetOrgTimeEntries: mocks.dbGetOrgTimeEntries,
  dbGetBreakSettings: mocks.dbGetBreakSettings,
}));

import { getJobsHours } from "@/lib/jobs-dal";

const membership = (id: string, name: string, role: string) => ({
  role,
  organization: { id, name },
});

const entry = (
  id: number,
  userId: string,
  orgId: string,
  clockIn = "2026-03-02T09:00:00Z",
  clockOut: string | null = "2026-03-02T17:00:00Z",
) => ({
  id,
  user_id: userId,
  org_id: orgId,
  clock_in: clockIn,
  clock_out: clockOut,
  clock_in_latitude: 50,
  clock_in_address: "1 Secret St",
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.protect.mockResolvedValue({ userId: "me", orgId: "org_a" });
  mocks.userMemberships.mockResolvedValue({
    data: [
      membership("org_b", "Bakery", "org:member"),
      membership("org_a", "Acme", "org:admin"),
    ],
    totalCount: 2,
  });
  mocks.orgMemberships.mockResolvedValue({
    data: [
      { publicUserData: { userId: "me", firstName: "Me" } },
      { publicUserData: { userId: "u2", firstName: "Sam", lastName: "Lee" } },
    ],
    totalCount: 2,
  });
  mocks.dbGetBreakSettings.mockResolvedValue(undefined);
  mocks.dbGetOrgTimeEntries.mockResolvedValue([
    entry(1, "me", "org_a"),
    entry(2, "u2", "org_a", "2026-03-03T09:00:00Z", "2026-03-03T13:00:00Z"),
    entry(3, "gone", "org_a", "2026-03-04T09:00:00Z", "2026-03-04T10:00:00Z"),
  ]);
  mocks.dbGetTimeEntries.mockResolvedValue([
    entry(10, "me", "org_b", "2026-03-05T09:00:00Z", "2026-03-05T11:00:00Z"),
  ]);
});

const filters = {
  start: "2026-03-01",
  end: "2026-03-07",
  timezone: "America/Regina",
};

describe("getJobsHours", () => {
  it("rejects a session without a user", async () => {
    mocks.protect.mockResolvedValue({ userId: null });
    await expect(getJobsHours(undefined)).resolves.toEqual({
      ok: false,
      error: { reason: "Unauthorized" },
    });
    expect(mocks.userMemberships).not.toHaveBeenCalled();
  });

  it("rejects an unknown time zone without reading anything", async () => {
    await expect(
      getJobsHours(undefined, { timezone: "Not/AZone" }),
    ).resolves.toEqual({ ok: false, error: { reason: "Invalid time zone" } });
    expect(mocks.userMemberships).not.toHaveBeenCalled();
  });

  it.each([[{ start: "garbage" }], [{ end: "garbage" }]])(
    "rejects an unreadable date (%o)",
    async (bad) => {
      await expect(getJobsHours(undefined, bad)).resolves.toEqual({
        ok: false,
        error: { reason: "Invalid date range" },
      });
      expect(mocks.dbGetTimeEntries).not.toHaveBeenCalled();
    },
  );

  it("reports when the jobs can't be listed", async () => {
    mocks.userMemberships.mockRejectedValue(new Error("clerk down"));
    await expect(getJobsHours(undefined)).resolves.toEqual({
      ok: false,
      error: { reason: "Could not load your jobs" },
    });
  });

  it("shows every job, everyone in admin jobs and only the caller elsewhere", async () => {
    const result = await getJobsHours(undefined, filters);
    if (!result.ok) throw new Error("expected ok");
    const view = result.value;

    expect(mocks.userMemberships).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "me" }),
    );
    expect(view.jobs.map((j) => j.name)).toEqual(["Acme", "Bakery"]);
    expect(view.selected).toEqual(["org_a", "org_b"]);

    const start = new Date("2026-03-01T06:00:00.000Z");
    const end = new Date("2026-03-08T05:59:59.999Z");
    expect(mocks.dbGetOrgTimeEntries).toHaveBeenCalledWith("org_a", start, end);
    expect(mocks.dbGetOrgTimeEntries).not.toHaveBeenCalledWith(
      "org_b",
      expect.anything(),
      expect.anything(),
    );
    expect(mocks.dbGetTimeEntries).toHaveBeenCalledWith(
      "me",
      "org_b",
      start,
      end,
    );
    // Member names are only ever fetched for jobs the caller administers.
    expect(mocks.orgMemberships).toHaveBeenCalledTimes(1);
    expect(mocks.orgMemberships).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_a" }),
    );

    const [acme, bakery] = view.results;
    expect(acme).toMatchObject({ isAdmin: true, totalHours: 13, shifts: 3 });
    expect(acme?.members.map((m) => m.name)).toEqual([
      "You",
      "Sam Lee",
      "Former member",
    ]);
    expect(bakery).toMatchObject({ isAdmin: false, totalHours: 2, shifts: 1 });
    expect(bakery?.members).toEqual([
      { userId: "me", name: "You", hours: 2, shifts: 1 },
    ]);
    expect(view.totalHours).toBe(15);
    expect(view.shifts).toBe(4);

    // Locations and addresses never leave the server.
    expect(JSON.stringify(view)).not.toContain("Secret");
  });

  it("drops anyone else's shift from a member's job, whatever the query returns", async () => {
    mocks.dbGetTimeEntries.mockResolvedValue([
      entry(10, "me", "org_b"),
      entry(11, "someone_else", "org_b"),
      entry(12, "me", "org_other"),
    ]);
    const result = await getJobsHours("org_b");
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.results).toHaveLength(1);
    expect(result.value.results[0]?.entries.map((e) => e.id)).toEqual([10]);
  });

  it("reads only the chosen jobs", async () => {
    const result = await getJobsHours("org_b", filters);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.selected).toEqual(["org_b"]);
    expect(result.value.jobs).toHaveLength(2);
    expect(mocks.dbGetOrgTimeEntries).not.toHaveBeenCalled();
  });

  it("never reads an org the caller doesn't belong to", async () => {
    const result = await getJobsHours("org_stranger,org_b");
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.selected).toEqual(["org_b"]);
    for (const call of [
      ...mocks.dbGetTimeEntries.mock.calls,
      ...mocks.dbGetOrgTimeEntries.mock.calls,
      ...mocks.dbGetBreakSettings.mock.calls,
    ]) {
      expect(JSON.stringify(call)).not.toContain("org_stranger");
    }
  });

  it("falls back to all of the caller's jobs when none of the chosen ones are theirs", async () => {
    const result = await getJobsHours("org_stranger");
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.selected).toEqual(["org_a", "org_b"]);
  });

  it("takes the admin role from the membership, not the active org", async () => {
    // Admin of the active org, but only a member of org_b.
    mocks.protect.mockResolvedValue({
      userId: "me",
      orgId: "org_b",
      orgRole: "org:admin",
    });
    await getJobsHours("org_b");
    expect(mocks.dbGetOrgTimeEntries).not.toHaveBeenCalled();
    expect(mocks.dbGetTimeEntries).toHaveBeenCalledWith(
      "me",
      "org_b",
      undefined,
      undefined,
    );
  });

  it("marks a job whose entries fail to load and keeps the rest", async () => {
    mocks.dbGetOrgTimeEntries.mockRejectedValue(new Error("db down"));
    const result = await getJobsHours(undefined);
    if (!result.ok) throw new Error("expected ok");
    const [acme, bakery] = result.value.results;
    expect(acme).toMatchObject({
      error: "Could not load this job's hours",
      shifts: 0,
      entries: [],
    });
    expect(bakery?.shifts).toBe(1);
  });

  it("still shows an admin's job when member names can't be read", async () => {
    mocks.orgMemberships.mockRejectedValue(new Error("clerk down"));
    const result = await getJobsHours("org_a");
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.results[0]?.members.map((m) => m.name)).toEqual([
      "You",
      "Former member",
      "Former member",
    ]);
  });
});
