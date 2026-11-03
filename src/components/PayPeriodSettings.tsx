"use client";

import { useMutation } from "@tanstack/react-query";
import { addDays, format, nextFriday } from "date-fns";
import { CalendarClock, Loader2 } from "lucide-react";
import { startTransition, useState } from "react";
import { toast } from "sonner";
import { updatePayPeriodSettingsAction } from "@/lib/actions";
import {
  describeHoldback,
  formatPayday,
  formatPayPeriodRange,
  isValidPayPeriodInput,
  listPayPeriods,
  type PayPeriodFrequency,
} from "@/lib/pay-period";
import type { PayPeriodSettingsData } from "@/lib/types";
import { Button, Card } from "./ui";

interface PayPeriodSettingsProps {
  initialData: PayPeriodSettingsData | null;
  onUpdateOptimistic: (next: Partial<PayPeriodSettingsData>) => void;
}

const HOLDBACK_OPTIONS = [0, 7, 14] as const;

type Draft = {
  enabled: boolean;
  frequency: PayPeriodFrequency;
  anchorPayday: string;
  holdbackDays: number;
};

function savedDraft(data: PayPeriodSettingsData | null): Draft {
  return {
    enabled: data?.enabled ?? false,
    frequency: data?.frequency ?? "bi-weekly",
    anchorPayday:
      data?.anchor_payday ??
      format(nextFriday(addDays(new Date(), -1)), "yyyy-MM-dd"),
    holdbackDays: data?.holdback_days ?? 0,
  };
}

export default function PayPeriodSettings({
  initialData,
  onUpdateOptimistic,
}: PayPeriodSettingsProps) {
  const saved = savedDraft(initialData);
  const [draft, setDraft] = useState<Draft>(saved);

  const { mutate, isPending } = useMutation({
    mutationFn: (next: Draft) =>
      updatePayPeriodSettingsAction(
        next.enabled,
        next.frequency,
        next.anchorPayday,
        next.holdbackDays,
      ),
    onSuccess: (res) => {
      if (res.success) {
        toast.success("Pay period settings updated");
      } else {
        toast.error(("error" in res && res.error) || "Update failed");
      }
    },
  });

  const valid = isValidPayPeriodInput(draft);
  const hasChanged =
    draft.enabled !== saved.enabled ||
    draft.frequency !== saved.frequency ||
    draft.anchorPayday !== saved.anchorPayday ||
    draft.holdbackDays !== saved.holdbackDays;

  const preview = valid
    ? listPayPeriods(
        {
          org_id: "",
          enabled: true,
          frequency: draft.frequency,
          anchor_payday: draft.anchorPayday,
          holdback_days: draft.holdbackDays,
        },
        new Date(),
        0,
        2,
      ).reverse()
    : [];

  const update = (next: Partial<Draft>) =>
    setDraft((prev) => ({ ...prev, ...next }));

  return (
    <Card className="p-8">
      <div className="mb-8">
        <h3 className="flex items-center gap-2 font-bold text-2xl tracking-tight">
          <CalendarClock className="h-6 w-6" />
          Pay Periods
        </h3>
        <p className="text-muted-foreground">
          Set your paydays and any hold-back so everyone can see which days each
          payday covers. When on, the Hours view gets a Pay Period timeframe.
        </p>
      </div>

      <div className="space-y-6">
        <label
          className="flex cursor-pointer items-start gap-3"
          htmlFor="pay-period-enabled"
        >
          <input
            checked={draft.enabled}
            className="mt-1 h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
            id="pay-period-enabled"
            onChange={(e) => update({ enabled: e.target.checked })}
            type="checkbox"
          />
          <span>
            <span className="block font-medium">Track pay periods</span>
            <span className="block text-muted-foreground text-sm">
              Show pay periods and paydays in the Hours view.
            </span>
          </span>
        </label>

        {draft.enabled && (
          <div className="space-y-6 pl-7">
            <div className="space-y-1">
              <label
                className="font-medium text-sm"
                htmlFor="pay-period-frequency"
              >
                How often you pay
              </label>
              <select
                className="h-12 w-full rounded-xl border-2 border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950"
                id="pay-period-frequency"
                onChange={(e) =>
                  update({ frequency: e.target.value as PayPeriodFrequency })
                }
                value={draft.frequency}
              >
                <option value="weekly">Every week</option>
                <option value="bi-weekly">Every 2 weeks</option>
              </select>
            </div>

            <div className="space-y-1">
              <label
                className="font-medium text-sm"
                htmlFor="pay-period-anchor"
              >
                A payday
              </label>
              <input
                className="h-12 w-full rounded-xl border-2 border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950"
                id="pay-period-anchor"
                onChange={(e) => update({ anchorPayday: e.target.value })}
                type="date"
                value={draft.anchorPayday}
              />
              <p className="text-muted-foreground text-sm">
                Any past or upcoming payday; the rest repeat from it.
              </p>
            </div>

            <div className="space-y-1">
              <label
                className="font-medium text-sm"
                htmlFor="pay-period-holdback"
              >
                Hold-back
              </label>
              <select
                className="h-12 w-full rounded-xl border-2 border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950"
                id="pay-period-holdback"
                onChange={(e) =>
                  update({ holdbackDays: Number(e.target.value) })
                }
                value={draft.holdbackDays}
              >
                {HOLDBACK_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {days === 0
                      ? "None — the period ends on payday"
                      : `${describeHoldback(days)} — paid ${describeHoldback(days)} after the period ends`}
                  </option>
                ))}
              </select>
            </div>

            {valid ? (
              <div className="space-y-2">
                <p className="font-medium text-sm">Upcoming pay periods</p>
                <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
                  {preview.map((period) => (
                    <li
                      className="flex justify-between gap-4 px-4 py-2"
                      key={period.payday.toISOString()}
                    >
                      <span>{formatPayPeriodRange(period)}</span>
                      <span className="text-muted-foreground">
                        Paid {formatPayday(period)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-red-600 text-sm dark:text-red-400">
                Pick a payday to see your pay periods.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-8 flex justify-end">
        <Button
          className="h-12 px-8 font-bold"
          disabled={isPending || !hasChanged || !valid}
          onClick={() => {
            startTransition(async () => {
              if (initialData) {
                onUpdateOptimistic({
                  enabled: draft.enabled,
                  frequency: draft.frequency,
                  anchor_payday: draft.anchorPayday,
                  holdback_days: draft.holdbackDays,
                });
              }
              await mutate(draft);
            });
          }}
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Pay Period Settings
        </Button>
      </div>
    </Card>
  );
}
