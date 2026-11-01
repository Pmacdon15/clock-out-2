"use client";

import { Palmtree } from "lucide-react";
import {
  formatTimeOffDates,
  formatTimeOffHours,
  TIME_OFF_TYPE_LABELS,
  timeOffHoursInRange,
} from "@/lib/time-off-utils";
import type { TimeOffRequest } from "@/lib/types";
import { Card } from "../ui";

interface TimeOffSummaryProps {
  requests: TimeOffRequest[];
  /** `YYYY-MM-DD`, inclusive. */
  startDate: string;
  endDate: string;
  /** Whose time off to show; null means every member. */
  userId: string | null;
  members: { id: string; name: string }[];
}

/**
 * Approved time off inside the Hours view's date range, with the hours it
 * covers. Time off is listed beside worked hours, never added into them.
 */
export function TimeOffSummary({
  requests,
  startDate,
  endDate,
  userId,
  members,
}: TimeOffSummaryProps) {
  const inRange = requests
    .filter(
      (request) =>
        request.status === "approved" &&
        (userId === null || request.user_id === userId),
    )
    .map((request) => ({
      request,
      hours: timeOffHoursInRange(request, startDate, endDate),
    }))
    .filter(({ hours }) => hours > 0)
    .sort((a, b) => a.request.start_date.localeCompare(b.request.start_date));

  if (inRange.length === 0) return null;

  const total = inRange.reduce((sum, { hours }) => sum + hours, 0);
  const names = new Map(members.map((m) => [m.id, m.name]));

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h4 className="flex items-center gap-2 font-bold">
          <Palmtree className="h-4 w-4" />
          Approved time off
        </h4>
        <span className="font-bold tabular-nums">
          {formatTimeOffHours(total)}
        </span>
      </div>
      <ul className="space-y-2 text-sm">
        {inRange.map(({ request, hours }) => (
          <li className="flex justify-between gap-2" key={request.id}>
            <span>
              {userId === null && (
                <span className="font-semibold">
                  {names.get(request.user_id) ?? "Unknown member"} ·{" "}
                </span>
              )}
              {TIME_OFF_TYPE_LABELS[request.request_type]} ·{" "}
              <span className="text-muted-foreground">
                {formatTimeOffDates(request)}
              </span>
            </span>
            <span className="tabular-nums">{formatTimeOffHours(hours)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
