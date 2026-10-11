"use client";

import { Download } from "lucide-react";
import { useMemo } from "react";
import {
  buildExportRows,
  type ExportFormat,
  exportTimesheet,
  formatHours,
  formatPeriod,
  totalHours,
} from "@/lib/timesheet-export";
import type { TimeEntry } from "@/lib/types";
import { Button, Card } from "../ui";

interface TimesheetExportProps {
  entries: TimeEntry[];
  employeeName: string;
  startDate: string;
  endDate: string;
  isViewingAll?: boolean;
  members?: { id: string; name: string }[];
}

export function TimesheetExport({
  entries,
  employeeName,
  startDate,
  endDate,
  isViewingAll = false,
  members = [],
}: TimesheetExportProps) {
  const rows = useMemo(
    () =>
      buildExportRows(entries, (userId) =>
        isViewingAll
          ? (members.find((m) => m.id === userId)?.name ?? "Unknown member")
          : employeeName,
      ),
    [entries, isViewingAll, members, employeeName],
  );

  const meta = { employee: employeeName, startDate, endDate };
  const isEmpty = rows.length === 0;

  const handleExport = (format: ExportFormat) => {
    exportTimesheet(format, rows, meta);
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
          disabled={isEmpty}
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
      </div>
    </Card>
  );
}
