"use client";

import { useMutation } from "@tanstack/react-query";
import { Hourglass, Loader2 } from "lucide-react";
import { startTransition, useState } from "react";
import { toast } from "sonner";
import { updateOvertimeSettingsAction } from "@/lib/actions";
import {
  getOvertimeThresholds,
  isValidOvertimeThreshold,
  MAX_DAILY_OVERTIME_HOURS,
  MAX_WEEKLY_OVERTIME_HOURS,
} from "@/lib/overtime";
import type { OvertimeSettingsData } from "@/lib/types";
import { Button, Card } from "./ui";

interface OvertimeSettingsProps {
  initialData: OvertimeSettingsData | null;
  onUpdateOptimistic: (next: Partial<OvertimeSettingsData>) => void;
}

const FIELDS = [
  {
    id: "daily",
    label: "Daily overtime",
    description: "Hours past this on a single day count as overtime.",
    inputLabel: "Hours per day",
    defaultHours: 8,
    max: MAX_DAILY_OVERTIME_HOURS,
  },
  {
    id: "weekly",
    label: "Weekly overtime",
    description:
      "Hours past this in a Monday–Sunday week count as overtime. Hours already counted as daily overtime are not counted again.",
    inputLabel: "Hours per week",
    defaultHours: 40,
    max: MAX_WEEKLY_OVERTIME_HOURS,
  },
] as const;

type Field = (typeof FIELDS)[number]["id"];

export default function OvertimeSettings({
  initialData,
  onUpdateOptimistic,
}: OvertimeSettingsProps) {
  const saved = getOvertimeThresholds(initialData);
  const [enabled, setEnabled] = useState<Record<Field, boolean>>({
    daily: saved.daily !== null,
    weekly: saved.weekly !== null,
  });
  const [hours, setHours] = useState<Record<Field, number>>({
    daily: saved.daily ?? FIELDS[0].defaultHours,
    weekly: saved.weekly ?? FIELDS[1].defaultHours,
  });

  const thresholds: Record<Field, number | null> = {
    daily: enabled.daily ? hours.daily : null,
    weekly: enabled.weekly ? hours.weekly : null,
  };

  const { mutate, isPending } = useMutation({
    mutationFn: (next: Record<Field, number | null>) =>
      updateOvertimeSettingsAction(next.daily, next.weekly),
    onSuccess: (res) => {
      if (res.success) {
        toast.success("Overtime settings updated");
      } else {
        toast.error(("error" in res && res.error) || "Update failed");
      }
    },
  });

  const hasChanged =
    thresholds.daily !== saved.daily || thresholds.weekly !== saved.weekly;
  const invalid = FIELDS.some(
    (field) => !isValidOvertimeThreshold(thresholds[field.id], field.max),
  );

  return (
    <Card className="p-8">
      <div className="mb-8">
        <h3 className="flex items-center gap-2 font-bold text-2xl tracking-tight">
          <Hourglass className="h-6 w-6" />
          Overtime
        </h3>
        <p className="text-muted-foreground">
          Set when hours start counting as overtime. Overtime is highlighted in
          the Hours view and shown separately in timesheet exports and emailed
          reports. Hours are counted after unpaid breaks are deducted.
        </p>
      </div>

      <div className="space-y-6">
        {FIELDS.map((field) => {
          const checkboxId = `overtime-${field.id}`;
          const inputId = `overtime-${field.id}-hours`;
          const fieldInvalid = !isValidOvertimeThreshold(
            thresholds[field.id],
            field.max,
          );
          return (
            <div className="space-y-2" key={field.id}>
              <label
                className="flex cursor-pointer items-start gap-3"
                htmlFor={checkboxId}
              >
                <input
                  checked={enabled[field.id]}
                  className="mt-1 h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
                  id={checkboxId}
                  onChange={(e) =>
                    setEnabled((prev) => ({
                      ...prev,
                      [field.id]: e.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                <span>
                  <span className="block font-medium">{field.label}</span>
                  <span className="block text-muted-foreground text-sm">
                    {field.description}
                  </span>
                </span>
              </label>
              {enabled[field.id] && (
                <div className="space-y-1 pl-7">
                  <label className="font-medium text-sm" htmlFor={inputId}>
                    {field.inputLabel}
                  </label>
                  <input
                    className="h-12 w-full rounded-xl border-2 border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950"
                    id={inputId}
                    max={field.max}
                    min={0.5}
                    onChange={(e) =>
                      setHours((prev) => ({
                        ...prev,
                        [field.id]: Number(e.target.value),
                      }))
                    }
                    step={0.5}
                    type="number"
                    value={hours[field.id]}
                  />
                  {fieldInvalid && (
                    <p className="text-red-600 text-sm dark:text-red-400">
                      Enter a number of hours greater than 0 and at most{" "}
                      {field.max}.
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
          disabled={isPending || !hasChanged || invalid}
          onClick={() => {
            startTransition(async () => {
              if (initialData) {
                onUpdateOptimistic({
                  daily_threshold_hours: thresholds.daily,
                  weekly_threshold_hours: thresholds.weekly,
                });
              }
              await mutate(thresholds);
            });
          }}
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Overtime Settings
        </Button>
      </div>
    </Card>
  );
}
