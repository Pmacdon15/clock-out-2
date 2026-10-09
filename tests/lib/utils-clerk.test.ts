import type { OrganizationMembership } from "@clerk/nextjs/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOrganizationMembershipList, clerkClient } = vi.hoisted(() => {
  const getOrganizationMembershipList = vi.fn();
  return {
    getOrganizationMembershipList,
    clerkClient: vi.fn(async () => ({
      organizations: { getOrganizationMembershipList },
    })),
  };
});
vi.mock("@clerk/nextjs/server", () => ({ clerkClient }));

import { getProcessedMembers, isOverMemberShipLimit } from "@/lib/utils-clerk";

describe("isOverMemberShipLimit", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns false when the org has no memberships", async () => {
    getOrganizationMembershipList.mockResolvedValue({ data: [] });
    await expect(isOverMemberShipLimit("org_1")).resolves.toBe(false);
    expect(getOrganizationMembershipList).toHaveBeenCalledWith({
      organizationId: "org_1",
    });
  });

  it("returns true when the member count exceeds the limit", async () => {
    getOrganizationMembershipList.mockResolvedValue({
      data: [{ organization: { maxAllowedMemberships: 1, membersCount: 2 } }],
    });
    await expect(isOverMemberShipLimit("org_1")).resolves.toBe(true);
  });

  it("returns false when the member count is within the limit", async () => {
    getOrganizationMembershipList.mockResolvedValue({
      data: [{ organization: { maxAllowedMemberships: 3, membersCount: 3 } }],
    });
    await expect(isOverMemberShipLimit("org_1")).resolves.toBe(false);
  });

  it("treats missing organization data as zero", async () => {
    getOrganizationMembershipList.mockResolvedValue({ data: [undefined] });
    await expect(isOverMemberShipLimit("org_1")).resolves.toBe(false);
  });

  it("fails closed when Clerk errors", async () => {
    getOrganizationMembershipList.mockRejectedValue(new Error("down"));
    await expect(isOverMemberShipLimit("org_1")).resolves.toBe(true);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("getProcessedMembers", () => {
  const member = (publicUserData: unknown) =>
    ({ publicUserData }) as unknown as OrganizationMembership;

  it("maps memberships to id/name pairs", async () => {
    const result = await getProcessedMembers("org_1", [
      member({ userId: "u1", firstName: "Ada", lastName: "Lovelace" }),
      member({ userId: "u2", firstName: "Grace", lastName: null }),
      member({ userId: "u3", identifier: "linus@example.com" }),
      member({ userId: "u4" }),
      member(undefined),
    ]);

    expect(result).toEqual([
      { id: "u1", name: "Ada Lovelace" },
      { id: "u2", name: "Grace" },
      { id: "u3", name: "linus@example.com" },
      { id: "u4", name: "Unknown Member" },
      { id: "", name: "Unknown Member" },
    ]);
  });
});
