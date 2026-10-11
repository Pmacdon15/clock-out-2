import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeEntry } from "../../utils";

const { exportTimesheet } = vi.hoisted(() => ({ exportTimesheet: vi.fn() }));
vi.mock("@/lib/timesheet-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/timesheet-export")>()),
  exportTimesheet,
}));

import { TimesheetExport } from "@/components/ViewHours/TimesheetExport";

const members = [{ id: "u1", name: "Ada" }];
const period = { startDate: "2026-03-08", endDate: "2026-03-14" };

describe("TimesheetExport", () => {
  it("summarises the period and exports PDF and spreadsheet", () => {
    render(
      <TimesheetExport
        employeeName="Me"
        entries={[makeEntry({ user_id: "me" })]}
        {...period}
      />,
    );

    expect(
      screen.getByText("Mar 8, 2026 - Mar 14, 2026 · 1 entry · 8.00 hrs"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(exportTimesheet).toHaveBeenLastCalledWith(
      "pdf",
      [expect.objectContaining({ employee: "Me", hours: 8 })],
      { employee: "Me", ...period },
    );

    fireEvent.click(screen.getByRole("button", { name: "Spreadsheet" }));
    expect(exportTimesheet).toHaveBeenLastCalledWith(
      "csv",
      expect.any(Array),
      expect.any(Object),
    );
  });

  it("names each member when exporting the whole org", () => {
    render(
      <TimesheetExport
        employeeName="Entire Organization"
        entries={[
          makeEntry({ user_id: "u1" }),
          makeEntry({ user_id: "gone" }),
        ]}
        isViewingAll
        members={members}
        {...period}
      />,
    );

    expect(screen.getByText(/2 entries · 16.00 hrs/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    const rows = exportTimesheet.mock.calls.at(-1)?.[1] as {
      employee: string;
    }[];
    expect(rows.map((r) => r.employee)).toEqual(["Ada", "Unknown member"]);
  });

  it("disables both downloads when there is nothing to export", () => {
    render(<TimesheetExport employeeName="Me" entries={[]} {...period} />);
    expect(screen.getByText(/0 entries · 0.00 hrs/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Spreadsheet" })).toBeDisabled();
  });
});
