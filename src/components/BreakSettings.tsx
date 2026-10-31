"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, Coffee, Loader2, Timer, XCircle } from "lucide-react";
import { startTransition, useState } from "react";
import { toast } from "sonner";
import { updateBreakSettingAction } from "@/lib/actions";
import {
  BREAK_LIMIT_FIELDS,
  BREAK_TYPE_VALUES,
  BREAK_TYPES,
  getBreakLimits,
  isValidBreakLimit,
  MAX_BREAK_LIMIT_MINUTES,
} from "@/lib/break-utils";
import type { BreakLimits, BreakSettingsData, BreakType } from "@/lib/types";
import { Button, Card } from "./ui";

interface BreakSettingsProps {
  initialData: BreakSettingsData | null;
  onUpdateOptimistic: (next: Partial<BreakSettingsData>) => void;
}

/** Starting value offered when an admin first switches a limit on. */
const DEFAULT_LIMIT_MINUTES: Record<BreakType, number> = {
  unpaid_meal: 30,
  unpaid_rest: 15,
  paid_rest: 15,
};

const options = [
  {
    id: false,
    label: "Do Not Dock Breaks",
    description: "Count all time between clock-in and clock-out",
    icon: XCircle,
  },
  {
    id: true,
    label: "Automatically Dock Lunch / Break",
    description:
      "Deduct unpaid break time from qualifying shifts unless marked as skipped",
    icon: Coffee,
  },
] as const;

export default function BreakSettings({
  initialData,
  onUpdateOptimistic,
}: BreakSettingsProps) {
  const [dockLunch, setDockLunch] = useState<boolean>(
    initialData?.dock_lunch ?? false,
  );
  const [durationMinutes, setDurationMinutes] = useState<number>(
    initialData?.lunch_duration_minutes || 30,
  );
  const [minShiftHours, setMinShiftHours] = useState<number>(
    initialData?.lunch_min_shift_hours ?? 5,
  );
  // The limits as stored. The meal limit here is the manual one; while lunch
  // is docked the deduction duration overrides it (see getBreakLimitMinutes).
  const savedLimits = getBreakLimits({
    max_meal_break_minutes: initialData?.max_meal_break_minutes,
    max_unpaid_rest_break_minutes: initialData?.max_unpaid_rest_break_minutes,
    max_paid_break_minutes: initialData?.max_paid_break_minutes,
  });
  const [limitEnabled, setLimitEnabled] = useState<Record<BreakType, boolean>>(
    () => ({
      unpaid_meal: savedLimits.unpaid_meal !== null,
      unpaid_rest: savedLimits.unpaid_rest !== null,
      paid_rest: savedLimits.paid_rest !== null,
    }),
  );
  const [limitMinutes, setLimitMinutes] = useState<Record<BreakType, number>>(
    () => ({
      unpaid_meal: savedLimits.unpaid_meal ?? DEFAULT_LIMIT_MINUTES.unpaid_meal,
      unpaid_rest: savedLimits.unpaid_rest ?? DEFAULT_LIMIT_MINUTES.unpaid_rest,
      paid_rest: savedLimits.paid_rest ?? DEFAULT_LIMIT_MINUTES.paid_rest,
    }),
  );
  const limits: BreakLimits = {
    // While lunch is docked the manual meal limit is hidden, so keep it as
    // stored rather than saving whatever is sitting in the hidden input.
    unpaid_meal: dockLunch
      ? savedLimits.unpaid_meal
      : limitEnabled.unpaid_meal
        ? limitMinutes.unpaid_meal
        : null,
    unpaid_rest: limitEnabled.unpaid_rest ? limitMinutes.unpaid_rest : null,
    paid_rest: limitEnabled.paid_rest ? limitMinutes.paid_rest : null,
  };

  const { mutate, isPending } = useMutation({
    mutationFn: ({
      dock,
      duration,
      minHours,
      breakLimits,
    }: {
      dock: boolean;
      duration: number;
      minHours: number;
      breakLimits: BreakLimits;
    }) => {
      return updateBreakSettingAction(dock, duration, minHours, breakLimits);
    },
    onSuccess: (res) => {
      if (res.success) {
        toast.success("Break settings updated");
      } else if ("error" in res) {
        toast.error(res.error || "Update failed");
      }
    },
  });

  const hasChanged =
    !initialData ||
    dockLunch !== initialData.dock_lunch ||
    BREAK_TYPE_VALUES.some((type) => limits[type] !== savedLimits[type]) ||
    (dockLunch &&
      (durationMinutes !== initialData.lunch_duration_minutes ||
        minShiftHours !== initialData.lunch_min_shift_hours));
  const limitsInvalid = BREAK_TYPE_VALUES.some(
    (type) => !isValidBreakLimit(limits[type]),
  );

  return (
    <Card className="p-8">
      <div className="mb-8">
        <h3 className="font-bold text-2xl tracking-tight">
          Lunch &amp; Break Deduction
        </h3>
        <p className="text-muted-foreground">
          Configure whether your organization automatically docks unpaid lunch
          or break time from shifts. Admins can still mark individual shifts as
          not docked when breaks are skipped.
        </p>
      </div>

      <div className="space-y-4">
        {options.map((option) => (
          <div className="space-y-4" key={String(option.id)}>
            <button
              className={`flex w-full items-center justify-between rounded-2xl border-2 p-6 text-left transition-all ${
                dockLunch === option.id
                  ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900"
                  : "border-transparent bg-zinc-100/50 hover:bg-zinc-100 dark:bg-zinc-800/50 dark:hover:bg-zinc-800"
              }`}
              onClick={() => setDockLunch(option.id)}
              type="button"
            >
              <div className="flex items-center gap-4">
                <div
                  className={`rounded-xl p-2 ${dockLunch === option.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black" : "bg-zinc-200 dark:bg-zinc-700"}`}
                >
                  <option.icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-bold text-lg">{option.label}</div>
                  <div className="text-muted-foreground text-sm">
                    {option.description}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {dockLunch === option.id && (
                  <div className="rounded-full bg-zinc-900 p-1 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
                    <Check className="h-4 w-4" />
                  </div>
                )}
                {initialData?.dock_lunch === option.id && (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-[10px] text-zinc-500 uppercase dark:bg-zinc-800">
                    Current
                  </span>
                )}
              </div>
            </button>

            {dockLunch && option.id === true && (
              <div className="fade-in slide-in-from-top-2 grid animate-in grid-cols-1 gap-4 p-6 pt-0 md:grid-cols-2">
                <div className="space-y-2">
                  <label
                    className="font-medium text-sm"
                    htmlFor="lunchDurationMinutes"
                  >
                    Break Duration (minutes)
                  </label>
                  <input
                    className="h-12 w-full rounded-xl border-2 border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950"
                    id="lunchDurationMinutes"
                    max={480}
                    min={1}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    type="number"
                    value={durationMinutes}
                  />
                </div>
                <div className="space-y-2">
                  <label
                    className="font-medium text-sm"
                    htmlFor="lunchMinShiftHours"
                  >
                    Minimum Shift Length (hours)
                  </label>
                  <input
                    className="h-12 w-full rounded-xl border-2 border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950"
                    id="lunchMinShiftHours"
                    max={24}
                    min={0}
                    onChange={(e) => setMinShiftHours(Number(e.target.value))}
                    step="0.5"
                    type="number"
                    value={minShiftHours}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-8 space-y-4 rounded-2xl border-2 border-zinc-200 p-6 dark:border-zinc-800">
        <div>
          <h4 className="flex items-center gap-2 font-bold text-lg">
            <Timer className="h-5 w-5" />
            Break Time Limits
          </h4>
          <p className="text-muted-foreground text-sm">
            When a break reaches its limit, it ends automatically and the member
            is clocked back in and told to return to work. Breaks ended late are
            recorded as ending at the limit.
          </p>
        </div>
        {BREAK_TYPE_VALUES.map((type) => {
          const checkboxId = `limit-${type}`;
          const inputId = BREAK_LIMIT_FIELDS[type];
          const invalid = !isValidBreakLimit(limits[type]);
          if (type === "unpaid_meal" && dockLunch) {
            return (
              <p
                className="text-muted-foreground text-sm"
                data-testid="meal-limit-from-deduction"
                key={type}
              >
                <span className="font-medium text-foreground">
                  {BREAK_TYPES[type].label}s
                </span>{" "}
                are limited to the {durationMinutes}-minute lunch deduction
                above.
              </p>
            );
          }
          return (
            <div className="space-y-2" key={type}>
              <label
                className="flex cursor-pointer items-center gap-3"
                htmlFor={checkboxId}
              >
                <input
                  checked={limitEnabled[type]}
                  className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
                  id={checkboxId}
                  onChange={(e) =>
                    setLimitEnabled((prev) => ({
                      ...prev,
                      [type]: e.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                <span className="font-medium">
                  Limit {BREAK_TYPES[type].label.toLowerCase()}s (
                  {BREAK_TYPES[type].paid ? "paid" : "unpaid"})
                </span>
              </label>
              {limitEnabled[type] && (
                <div className="space-y-1 pl-7">
                  <label className="font-medium text-sm" htmlFor={inputId}>
                    Max {BREAK_TYPES[type].label} (minutes)
                  </label>
                  <input
                    className="h-12 w-full rounded-xl border-2 border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950"
                    id={inputId}
                    max={MAX_BREAK_LIMIT_MINUTES}
                    min={1}
                    onChange={(e) =>
                      setLimitMinutes((prev) => ({
                        ...prev,
                        [type]: Number(e.target.value),
                      }))
                    }
                    step={1}
                    type="number"
                    value={limitMinutes[type]}
                  />
                  {invalid && (
                    <p className="text-red-600 text-sm dark:text-red-400">
                      Enter a whole number of minutes between 1 and{" "}
                      {MAX_BREAK_LIMIT_MINUTES}.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex justify-end">
        <Button
          className="h-12 px-8 font-bold"
          disabled={isPending || !hasChanged || limitsInvalid}
          onClick={() => {
            startTransition(async () => {
              if (initialData) {
                onUpdateOptimistic({
                  ...initialData,
                  dock_lunch: dockLunch,
                  lunch_duration_minutes: durationMinutes,
                  lunch_min_shift_hours: minShiftHours,
                  max_meal_break_minutes: limits.unpaid_meal,
                  max_unpaid_rest_break_minutes: limits.unpaid_rest,
                  max_paid_break_minutes: limits.paid_rest,
                });
              }

              await mutate({
                dock: dockLunch,
                duration: durationMinutes,
                minHours: minShiftHours,
                breakLimits: limits,
              });
            });
          }}
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Break Settings
        </Button>
      </div>
    </Card>
  );
}
