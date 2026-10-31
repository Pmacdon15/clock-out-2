"use client";

import { useOrganization } from "@clerk/nextjs";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { loadPdfImage } from "@/lib/pdf-image";
import {
  buildExportRows,
  type ExportFormat,
  type ExportMeta,
  exportTimesheet,
  formatHours,
  formatPeriod,
  totalHours,
} from "@/lib/timesheet-export";
import type { BreakSettingsData, TimeEntry } from "@/lib/types";
import { Button, Card } from "../ui";

interface TimesheetExportProps {
  entries: TimeEntry[];
  employeeName: string;
  startDate: string;
  endDate: string;
  isViewingAll?: boolean;
  members?: { id: string; name: string }[];
  breakSettings?: BreakSettingsData | null;
}

export function TimesheetExport({
  entries,
  employeeName,
  startDate,
  endDate,
  isViewingAll = false,
  members = [],
  breakSettings,
}: TimesheetExportProps) {
  const { organization } = useOrganization();
  const [isExporting, setIsExporting] = useState(false);

  const rows = useMemo(
    () =>
      buildExportRows(
        entries,
        (userId) =>
          isViewingAll
            ? (members.find((m) => m.id === userId)?.name ?? "Unknown member")
            : employeeName,
        undefined,
        breakSettings,
      ),
    [entries, isViewingAll, members, employeeName, breakSettings],
  );

  const meta: ExportMeta = { employee: employeeName, startDate, endDate };
  const isEmpty = rows.length === 0;

  const handleExport = async (format: ExportFormat) => {
    if (format !== "pdf") {
      exportTimesheet(format, rows, meta);
      return;
    }
    setIsExporting(true);
    try {
      // Only use uploaded logos — skip Clerk's generated placeholder avatar.
      const orgLogo = organization?.hasImage
        ? await loadPdfImage(organization.imageUrl)
        : null;
      exportTimesheet(format, rows, {
        ...meta,
        ...(organization ? { orgName: organization.name } : {}),
        ...(orgLogo ? { orgLogo } : {}),
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="font-bold text-lg">Export Timesheet</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {formatPeriod(meta)} · {rows.length}{" "}
          {rows.length === 1 ? "entry" : "entries"} ·{" "}
          {formatHours(totalHours(rows))} hrs
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          disabled={isEmpty || isExporting}
          onClick={() => handleExport("pdf")}
          size="sm"
          variant="outline"
        >
          <Download className="mr-2 h-4 w-4" />
          PDF
        </Button>
        <Button
          disabled={isEmpty}
          onClick={() => handleExport("xlsx")}
          size="sm"
          variant="outline"
        >
          <Download className="mr-2 h-4 w-4" />
          Spreadsheet
        </Button>
        <Button
          disabled={isEmpty}
          onClick={() => handleExport("csv")}
          size="sm"
          variant="outline"
        >
          <Download className="mr-2 h-4 w-4" />
          CSV
        </Button>
      </div>
    </Card>
  );
}
