import { clerkClient } from "@clerk/nextjs/server";

export async function isOverMemberShipLimit(orgId: string) {
  try {
    const client = await clerkClient();

    const { data } = await client.organizations.getOrganizationMembershipList({
      organizationId: orgId,
    });

    if (data.length === 0) return false;

    const maxAllowed = data[0]?.organization?.maxAllowedMemberships ?? 0;
    const currentCount = data[0]?.organization?.membersCount ?? 0;

    console.log(`Max: ${maxAllowed}, Current: ${currentCount}`);

    return currentCount > maxAllowed;
  } catch (error) {
    console.error("Error getting membership status:", error);
    return true;
  }
}

export async function getProcessedMembers(
  orgId: string,
  rawMembersArray: any[],
) {
  return rawMembersArray.map((m) => {
    const userData = m.publicUserData;
    return {
      id: userData?.userId || "",
      name: userData?.firstName
        ? `${userData.firstName} ${userData.lastName || ""}`.trim()
        : userData?.identifier || "Unknown Member",
    };
  });
}
