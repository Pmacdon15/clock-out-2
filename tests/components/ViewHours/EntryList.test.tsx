import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeEntry } from "../../utils";

vi.mock("@/components/ViewHours/EntryItem", () => ({
  EntryItem: ({
    entry,
    isAdmin,
    memberName,
  }: {
    entry: { id: number };
    isAdmin: boolean;
    memberName?: string;
  }) => (
    <div data-testid="entry">
      {entry.id}|{String(isAdmin)}|{memberName ?? "none"}
    </div>
  ),
}));

import { EntryList } from "@/components/ViewHours/EntryList";

const members = [{ id: "u1", name: "Ada" }];

describe("EntryList", () => {
  it("shows an empty state", () => {
    render(
      <EntryList entries={[]} isAdmin={false} setOptimisticEntries={vi.fn()} />,
    );
    expect(screen.getByText("No entries for this period")).toBeInTheDocument();
    expect(
      screen.getByText("Individual clock-in and clock-out history."),
    ).toBeInTheDocument();
  });

  it("renders entries without member names for a single user", () => {
    render(
      <EntryList
        entries={[makeEntry({ id: 1, user_id: "u1" })]}
        isAdmin
        members={members}
        setOptimisticEntries={vi.fn()}
      />,
    );
    expect(screen.getByTestId("entry")).toHaveTextContent("1|true|none");
  });

  it("labels entries with member names when viewing everyone", () => {
    render(
      <EntryList
        entries={[
          makeEntry({ id: 1, user_id: "u1" }),
          makeEntry({ id: 2, user_id: "gone" }),
        ]}
        isAdmin={false}
        isViewingAll
        members={members}
        setOptimisticEntries={vi.fn()}
      />,
    );
    const rows = screen.getAllByTestId("entry");
    expect(rows[0]).toHaveTextContent("1|false|Ada");
    expect(rows[1]).toHaveTextContent("2|false|none");
    expect(
      screen.getByText("Logged entries for all selected team members."),
    ).toBeInTheDocument();
  });

  it("defaults to no members when viewing everyone", () => {
    render(
      <EntryList
        entries={[makeEntry({ id: 3, user_id: "u1" })]}
        isAdmin={false}
        isViewingAll
        setOptimisticEntries={vi.fn()}
      />,
    );
    expect(screen.getByTestId("entry")).toHaveTextContent("3|false|none");
  });
});
