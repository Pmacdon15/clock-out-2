"use client";

import { useUser } from "@clerk/nextjs";
import { use, useMemo, useState } from "react";
import type { ViewHoursProps } from "@/lib/types";
import { DaysWorkedBreakdown } from "./ViewHours/DaysWorkedBreakdown";
import { EntryList } from "./ViewHours/EntryList";
import { HoursBarChart } from "./ViewHours/HoursBarChart";
import { HoursLineChart } from "./ViewHours/HoursLineChart";
import { MemberToggles } from "./ViewHours/MemberToggles";
import {
  TimeframeSelector,
  type TimeframeValue,
} from "./ViewHours/TimeframeSelector";

export default function ViewHours({
  entries,
  setOptimisticEntries,
  isAdmin = false,
  membersPromise,
  orgTimeEntriesPromise,
  selectedUserIdPromise,
  timeframePromise,
  startDatePromise,
  endDatePromise,
  currentUserIdPromise,
}: ViewHoursProps) {
  const { user } = useUser();
  const currentUserId = use(currentUserIdPromise || Promise.resolve(""));
  const members = use(membersPromise || Promise.resolve([]));
  const selectedUserId = use(selectedUserIdPromise || Promise.resolve(""));
  const orgTimeEntriesResult = use(orgTimeEntriesPromise);

  const startDate =
    (startDatePromise ? use(startDatePromise) : null) ??
    new Date().toLocaleDateString("en-CA");
  const endDate =
    (endDatePromise ? use(endDatePromise) : null) ??
    new Date().toLocaleDateString("en-CA");

  const orgEntries = useMemo(() => {
    return orgTimeEntriesResult.ok ? orgTimeEntriesResult.value : [];
  }, [orgTimeEntriesResult]);

  const isViewingAll = selectedUserId === "all" && isAdmin;

  const timeframe =
    (use(timeframePromise || Promise.resolve(undefined)) as TimeframeValue) ||
    "week";

  const [chartType, setChartType] = useState<"bar" | "line">("bar");

  const selectedMember = useMemo(
    () => members.find((m) => m.id === selectedUserId),
    [members, selectedUserId],
  );

  const employeeName = useMemo(() => {
    if (isViewingAll) return "Entire Organization";
    if (selectedUserId) return selectedMember?.name || "Employee";
    return user?.fullName || "You";
  }, [isViewingAll, selectedUserId, selectedMember, user]);

  // Member visibility state for Org view
  const [visibleMemberIds, setVisibleMemberIds] = useState<Set<string>>(
    new Set(members.map((m) => m.id)),
  );

  const toggleMember = (id: string) => {
    const newSet = new Set(visibleMemberIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setVisibleMemberIds(newSet);
  };

  const toggleAll = () => {
    if (visibleMemberIds.size === members.length) {
      setVisibleMemberIds(new Set());
    } else {
      setVisibleMemberIds(new Set(members.map((m) => m.id)));
    }
  };

  // Derive available years
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, []);

  // Since the entries are already filtered by the server, we use them directly.
  const displayEntries = isViewingAll ? orgEntries : entries;

  // Previous total hours calculation placeholder
  const previousTotalHours = 0;

  const lineChartMembers = useMemo(() => {
    if (isViewingAll) return members;
    return [{ id: selectedUserId || currentUserId || "", name: employeeName }];
  }, [isViewingAll, members, selectedUserId, currentUserId, employeeName]);

  const lineChartVisibleIds = useMemo(() => {
    if (isViewingAll) return visibleMemberIds;
    return new Set([selectedUserId || currentUserId || ""]);
  }, [isViewingAll, visibleMemberIds, selectedUserId, currentUserId]);

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col gap-6">
        <TimeframeSelector
          availableYears={availableYears}
          currentUserId={currentUserId}
          endDate={endDate}
          isAdmin={isAdmin}
          members={members}
          selectedUserId={selectedUserId}
          startDate={startDate}
          timeframe={timeframe}
        />

        <div className="flex w-full justify-center">
          <div className="flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
            <button
              className={`px-4 py-1.5 font-bold text-xs transition-all ${
                chartType === "bar"
                  ? "rounded-md bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
              }`}
              onClick={() => setChartType("bar")}
              type="button"
            >
              BAR CHART
            </button>
            <button
              className={`px-4 py-1.5 font-bold text-xs transition-all ${
                chartType === "line"
                  ? "rounded-md bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
              }`}
              onClick={() => setChartType("line")}
              type="button"
            >
              LINE CHART
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {chartType === "bar" ? (
            <HoursBarChart
              employeeName={employeeName}
              filteredEntries={displayEntries}
              isViewingAll={isViewingAll}
              members={members}
              previousTotalHours={previousTotalHours}
              startDate={startDate}
              endDate={endDate}
              timeframe={timeframe}
              visibleMemberIds={visibleMemberIds}
            />
          ) : (
            <HoursLineChart
              employeeName={employeeName}
              filteredEntries={displayEntries}
              isViewingAll={isViewingAll}
              members={lineChartMembers}
              startDate={startDate}
              endDate={endDate}
              timeframe={timeframe}
              visibleMemberIds={lineChartVisibleIds}
            />
          )}
        </div>

        <div className="space-y-6 lg:col-span-2">
          {isViewingAll && (
            <MemberToggles
              members={members}
              toggleAll={toggleAll}
              toggleMember={toggleMember}
              visibleMemberIds={visibleMemberIds}
            />
          )}
          <DaysWorkedBreakdown
            entries={displayEntries}
            isViewingAll={isViewingAll}
          />
          <EntryList
            entries={displayEntries}
            isAdmin={isAdmin}
            isViewingAll={isViewingAll}
            members={members}
            setOptimisticEntries={setOptimisticEntries}
          />
        </div>
      </div>
    </div>
  );
}
