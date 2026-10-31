import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeEntry } from "../../utils";

const { exportTimesheet, loadPdfImage, org } = vi.hoisted(() => ({
  exportTimesheet: vi.fn(),
  loadPdfImage: vi.fn(),
  org: {
    value: null as null | { name: string; hasImage: boolean; imageUrl: string },
  },
}));
vi.mock("@/lib/timesheet-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/timesheet-export")>()),
  exportTimesheet,
}));
vi.mock("@/lib/pdf-image", () => ({ loadPdfImage }));
vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: org.value }),
}));

import { TimesheetExport } from "@/components/ViewHours/TimesheetExport";

const members = [{ id: "u1", name: "Ada" }];
const period = { startDate: "2026-03-08", endDate: "2026-03-14" };
const logo = {
  width: 1,
  height: 1,
  colorSpace: "DeviceRGB",
  filter: "DCTDecode",
  data: new Uint8Array(),
};

describe("TimesheetExport", () => {
  beforeEach(() => {
    org.value = null;
  });

  it("summarises the period and exports PDF and spreadsheet", async () => {
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
    await waitFor(() =>
      expect(exportTimesheet).toHaveBeenLastCalledWith(
        "pdf",
        [expect.objectContaining({ employee: "Me", hours: 8 })],
        { employee: "Me", ...period },
      ),
    );
    expect(loadPdfImage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Spreadsheet" }));
    expect(exportTimesheet).toHaveBeenLastCalledWith(
      "xlsx",
      expect.any(Array),
      { employee: "Me", ...period },
    );

    fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    expect(exportTimesheet).toHaveBeenLastCalledWith("csv", expect.any(Array), {
      employee: "Me",
      ...period,
    });
  });

  it("brands the PDF with the org name and uploaded logo", async () => {
    org.value = {
      name: "Acme",
      hasImage: true,
      imageUrl: "https://img.clerk.com/acme",
    };
    loadPdfImage.mockResolvedValueOnce(logo);
    render(
      <TimesheetExport
        employeeName="Me"
        entries={[makeEntry({ user_id: "me" })]}
        {...period}
      />,
    );

    const pdfButton = screen.getByRole("button", { name: "PDF" });
    fireEvent.click(pdfButton);
    expect(pdfButton).toBeDisabled();
    await waitFor(() => expect(pdfButton).not.toBeDisabled());

    expect(loadPdfImage).toHaveBeenCalledWith("https://img.clerk.com/acme");
    expect(exportTimesheet).toHaveBeenLastCalledWith("pdf", expect.any(Array), {
      employee: "Me",
      ...period,
      orgName: "Acme",
      orgLogo: logo,
    });
  });

  it("skips Clerk's placeholder avatar and logos that fail to load", async () => {
    org.value = { name: "Acme", hasImage: false, imageUrl: "placeholder" };
    const { unmount } = render(
      <TimesheetExport
        employeeName="Me"
        entries={[makeEntry({ user_id: "me" })]}
        {...period}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() =>
      expect(exportTimesheet).toHaveBeenLastCalledWith(
        "pdf",
        expect.any(Array),
        { employee: "Me", ...period, orgName: "Acme" },
      ),
    );
    expect(loadPdfImage).not.toHaveBeenCalled();
    unmount();

    org.value = { name: "Acme", hasImage: true, imageUrl: "broken" };
    loadPdfImage.mockResolvedValueOnce(null);
    render(
      <TimesheetExport
        employeeName="Me"
        entries={[makeEntry({ user_id: "me" })]}
        {...period}
      />,
    );
    exportTimesheet.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() =>
      expect(exportTimesheet).toHaveBeenLastCalledWith(
        "pdf",
        expect.any(Array),
        { employee: "Me", ...period, orgName: "Acme" },
      ),
    );
  });

  it("names each member when exporting the whole org", async () => {
    render(
      <TimesheetExport
        employeeName="Entire Organization"
        entries={[makeEntry({ user_id: "u1" }), makeEntry({ user_id: "gone" })]}
        isViewingAll
        members={members}
        {...period}
      />,
    );

    expect(screen.getByText(/2 entries · 16.00 hrs/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(exportTimesheet).toHaveBeenCalled());
    const rows = exportTimesheet.mock.calls.at(-1)?.[1] as {
      employee: string;
    }[];
    expect(rows.map((r) => r.employee)).toEqual(["Ada", "Unknown member"]);
  });

  it("disables every download when there is nothing to export", () => {
    render(<TimesheetExport employeeName="Me" entries={[]} {...period} />);
    expect(screen.getByText(/0 entries · 0.00 hrs/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Spreadsheet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "CSV" })).toBeDisabled();
  });
});
