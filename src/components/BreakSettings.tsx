"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, Coffee, Loader2, XCircle } from "lucide-react";
import { startTransition, useState } from "react";
import { toast } from "sonner";
import { updateBreakSettingAction } from "@/lib/actions";
import type { BreakSettingsData } from "@/lib/types";
import { Button, Card } from "./ui";

interface BreakSettingsProps {
  initialData: BreakSettingsData | null;
  onUpdateOptimistic: (next: Partial<BreakSettingsData>) => void;
}

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

  const { mutate, isPending } = useMutation({
    mutationFn: ({
      dock,
      duration,
      minHours,
    }: {
      dock: boolean;
      duration: number;
      minHours: number;
    }) => {
      return updateBreakSettingAction(dock, duration, minHours);
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
    (dockLunch &&
      (durationMinutes !== initialData.lunch_duration_minutes ||
        minShiftHours !== initialData.lunch_min_shift_hours));

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

      <div className="mt-8 flex justify-end">
        <Button
          className="h-12 px-8 font-bold"
          disabled={isPending || !hasChanged}
          onClick={() => {
            startTransition(async () => {
              if (initialData) {
                onUpdateOptimistic({
                  ...initialData,
                  dock_lunch: dockLunch,
                  lunch_duration_minutes: durationMinutes,
                  lunch_min_shift_hours: minShiftHours,
                });
              }

              await mutate({
                dock: dockLunch,
                duration: durationMinutes,
                minHours: minShiftHours,
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
