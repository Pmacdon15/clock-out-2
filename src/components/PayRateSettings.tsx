"use client";

import { DollarSign, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { updateMemberPayRateAction } from "@/lib/actions";
import {
  DEFAULT_OVERTIME_MULTIPLIER,
  isValidHourlyRate,
  isValidOvertimeMultiplier,
  MAX_HOURLY_RATE,
  MAX_OVERTIME_MULTIPLIER,
  MIN_OVERTIME_MULTIPLIER,
  payRateMap,
} from "@/lib/pay";
import type { PayRateData } from "@/lib/types";
import { Button, Card } from "./ui";

interface PayRateSettingsProps {
  members: { id: string; name: string }[];
  initialRates: PayRateData[];
}

type Draft = { rate: string; multiplier: string };

/** The form's text for a saved rate ("" = no rate). */
const toDraft = (
  saved: { hourlyRate: number; overtimeMultiplier: number } | undefined,
): Draft => ({
  rate: saved ? String(saved.hourlyRate) : "",
  multiplier: String(saved?.overtimeMultiplier ?? DEFAULT_OVERTIME_MULTIPLIER),
});

/** A draft as the values to save; `rate` null clears the member's rate. */
const parseDraft = (draft: Draft) => ({
  rate: draft.rate.trim() === "" ? null : Number(draft.rate),
  multiplier: Number(draft.multiplier),
});

function MemberPayRateRow({
  member,
  saved,
}: {
  member: { id: string; name: string };
  saved: { hourlyRate: number; overtimeMultiplier: number } | undefined;
}) {
  const [current, setCurrent] = useState(saved);
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved));
  const [isPending, setIsPending] = useState(false);

  const { rate, multiplier } = parseDraft(draft);
  const rateInvalid = rate !== null && !isValidHourlyRate(rate);
  const multiplierInvalid = !isValidOvertimeMultiplier(multiplier);
  const hasChanged =
    rate !== (current?.hourlyRate ?? null) ||
    // Only reached with a saved rate equal to the draft's, so `current` is set.
    (rate !== null && multiplier !== current?.overtimeMultiplier);

  const save = async () => {
    setIsPending(true);
    try {
      const res = await updateMemberPayRateAction(member.id, rate, multiplier);
      if (res.success) {
        setCurrent(
          rate === null
            ? undefined
            : { hourlyRate: rate, overtimeMultiplier: multiplier },
        );
        toast.success(
          rate === null
            ? `Pay rate cleared for ${member.name}`
            : `Pay rate saved for ${member.name}`,
        );
      } else {
        toast.error(("error" in res && res.error) || "Update failed");
      }
    } finally {
      setIsPending(false);
    }
  };

  const rateId = `pay-rate-${member.id}`;
  const multiplierId = `pay-multiplier-${member.id}`;

  return (
    <li
      className="space-y-2 rounded-xl border-2 border-zinc-100 p-4 dark:border-zinc-900"
      data-testid={`pay-rate-row-${member.id}`}
    >
      <div className="font-medium">{member.name}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <label className="text-muted-foreground text-sm" htmlFor={rateId}>
            Hourly rate ($)
          </label>
          <input
            className="h-11 w-full rounded-xl border-2 border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950"
            id={rateId}
            inputMode="decimal"
            max={MAX_HOURLY_RATE}
            min={0}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, rate: e.target.value }))
            }
            placeholder="No rate"
            step={0.01}
            type="number"
            value={draft.rate}
          />
        </div>
        <div className="space-y-1">
          <label
            className="text-muted-foreground text-sm"
            htmlFor={multiplierId}
          >
            Overtime multiplier
          </label>
          <input
            className="h-11 w-full rounded-xl border-2 border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950"
            id={multiplierId}
            inputMode="decimal"
            max={MAX_OVERTIME_MULTIPLIER}
            min={MIN_OVERTIME_MULTIPLIER}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, multiplier: e.target.value }))
            }
            step={0.25}
            type="number"
            value={draft.multiplier}
          />
        </div>
        <Button
          className="h-11 px-6 font-bold"
          disabled={
            isPending || !hasChanged || rateInvalid || multiplierInvalid
          }
          onClick={save}
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </div>
      {rateInvalid && (
        <p className="text-red-600 text-sm dark:text-red-400">
          Enter an hourly rate from 0 to {MAX_HOURLY_RATE}, or leave it blank
          for no rate.
        </p>
      )}
      {multiplierInvalid && (
        <p className="text-red-600 text-sm dark:text-red-400">
          Enter a multiplier from {MIN_OVERTIME_MULTIPLIER} to{" "}
          {MAX_OVERTIME_MULTIPLIER}.
        </p>
      )}
    </li>
  );
}

export default function PayRateSettings({
  members,
  initialRates,
}: PayRateSettingsProps) {
  const saved = payRateMap(initialRates);

  return (
    <Card className="p-8">
      <div className="mb-8">
        <h3 className="flex items-center gap-2 font-bold text-2xl tracking-tight">
          <DollarSign className="h-6 w-6" />
          Pay Rates
        </h3>
        <p className="text-muted-foreground">
          Set each member's hourly rate and overtime multiplier (1.5 is time and
          a half). Estimated gross pay — regular hours at the rate plus overtime
          at rate × multiplier — is shown in the Hours view and in timesheet
          exports. Members only ever see their own rate.
        </p>
      </div>
      {members.length === 0 ? (
        <p className="text-muted-foreground text-sm">No members to show yet.</p>
      ) : (
        <ul className="space-y-3">
          {members.map((member) => (
            <MemberPayRateRow
              key={member.id}
              member={member}
              saved={saved.get(member.id)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
