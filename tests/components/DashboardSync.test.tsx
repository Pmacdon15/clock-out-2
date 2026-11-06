import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { resolved } from "../utils";

const mocks = vi.hoisted(() => ({
  orgSwitcher: vi.fn(),
  synced: [] as unknown[],
}));

vi.mock("@/components/OrgSwitcher", () => ({
  useOrgSwitcher: mocks.orgSwitcher,
}));
vi.mock("@/components/TimezoneSync", () => ({
  default: ({ settingsPromise }: { settingsPromise: unknown }) => {
    mocks.synced.push(settingsPromise);
    return <div data-testid="timezone-sync" />;
  },
}));
vi.mock("@/components/PushTokenSync", () => ({
  default: ({ settingsPromise }: { settingsPromise: unknown }) => {
    mocks.synced.push(settingsPromise);
    return <div data-testid="push-token-sync" />;
  },
}));

import DashboardSync from "@/components/DashboardSync";

describe("DashboardSync", () => {
  it("follows the active org and syncs the time zone and push token", () => {
    const orgIdPromise = resolved("org_1");
    const settingsPromise = resolved({
      ok: false as const,
      error: { reason: "x" },
    });
    render(
      <DashboardSync
        orgIdPromise={orgIdPromise}
        settingsPromise={settingsPromise}
      />,
    );
    expect(mocks.orgSwitcher).toHaveBeenCalledWith(orgIdPromise);
    expect(screen.getByTestId("timezone-sync")).toBeInTheDocument();
    expect(screen.getByTestId("push-token-sync")).toBeInTheDocument();
    expect(mocks.synced).toEqual([settingsPromise, settingsPromise]);
  });
});
