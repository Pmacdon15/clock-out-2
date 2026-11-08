"use client";

import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { createShiftRequestAction } from "@/lib/shift-request-actions";
import type { TradeableShift } from "@/lib/shift-requests-dal";
import type { ShiftRequestType } from "@/lib/types";
import { Button } from "./ui";

const inputClass =
  "h-11 w-full rounded-xl border-2 border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950";

const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const shiftLabel = (shift: TradeableShift) =>
  `${format(new Date(shift.shift_start), "EEE, MMM d, h:mm a")} – ${format(new Date(shift.shift_end), "h:mm a")}`;

const TYPE_OPTIONS: { value: ShiftRequestType; label: string; hint: string }[] =
  [
    {
      value: "offer",
      label: "Give away my shift",
      hint: "Post your shift for a coworker to claim.",
    },
    {
      value: "swap",
      label: "Swap shifts",
      hint: "Trade your shift for a coworker's. They accept first.",
    },
    {
      value: "pickup",
      label: "Take a coworker's shift",
      hint: "Ask a coworker for their shift. They accept first.",
    },
  ];

interface NewShiftRequestFormProps {
  shifts: TradeableShift[];
  names: Record<string, string>;
  userId: string;
}

/**
 * Starts a shift swap or pickup from the Schedule page: offer your shift,
 * swap it for a coworker's, or ask to take a coworker's. A manager approves
 * before the schedule changes; the server enforces every rule.
 */
export default function NewShiftRequestForm({
  shifts,
  names,
  userId,
}: NewShiftRequestFormProps) {
  const [type, setType] = useState<ShiftRequestType>("offer");
  const [shiftId, setShiftId] = useState("");
  const [swapShiftId, setSwapShiftId] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [note, setNote] = useState("");

  const mine = shifts.filter((s) => s.user_id === userId);
  const theirs = shifts.filter((s) => s.user_id !== userId);
  const coworkers = Object.entries(names)
    .filter(([id]) => id !== userId)
    .sort(([, a], [, b]) => a.localeCompare(b));
  const name = (id: string) => names[id] || "A team member";

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      createShiftRequestAction(
        {
          type,
          shiftId: Number(shiftId),
          swapShiftId: type === "swap" ? Number(swapShiftId) : null,
          targetUserId: type === "offer" ? targetUserId || null : null,
          note: note || null,
        },
        browserTimezone(),
      ),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(
          type === "offer"
            ? "Shift posted"
            : "Request sent: your coworker needs to accept",
        );
        setShiftId("");
        setSwapShiftId("");
        setTargetUserId("");
        setNote("");
      } else {
        toast.error(res.error);
      }
    },
  });

  const changeType = (next: ShiftRequestType) => {
    setType(next);
    setShiftId("");
    setSwapShiftId("");
    setTargetUserId("");
  };

  // Offer and swap give up one of your shifts; a pickup takes a coworker's.
  const shiftChoices = type === "pickup" ? theirs : mine;
  const canSubmit =
    Boolean(shiftId) && (type !== "swap" || Boolean(swapShiftId)) && !isPending;
  const hint = TYPE_OPTIONS.find((o) => o.value === type)?.hint;

  return (
    <form
      aria-label="New shift request"
      className="mt-4 grid grid-cols-1 gap-4 rounded-2xl border-2 border-zinc-100 p-4 sm:grid-cols-2 dark:border-zinc-800"
      onSubmit={(e) => {
        e.preventDefault();
        mutate();
      }}
    >
      <div className="space-y-1.5 sm:col-span-2">
        <label className="font-medium text-sm" htmlFor="shiftRequestType">
          What do you want to do?
        </label>
        <select
          className={inputClass}
          id="shiftRequestType"
          onChange={(e) => changeType(e.target.value as ShiftRequestType)}
          value={type}
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <label className="font-medium text-sm" htmlFor="shiftRequestShift">
          {type === "pickup" ? "Coworker's shift" : "Your shift"}
        </label>
        <select
          className={inputClass}
          disabled={shiftChoices.length === 0}
          id="shiftRequestShift"
          onChange={(e) => setShiftId(e.target.value)}
          value={shiftId}
        >
          <option value="">
            {shiftChoices.length === 0
              ? type === "pickup"
                ? "No coworker shifts available"
                : "You have no upcoming shifts to trade"
              : "Choose a shift…"}
          </option>
          {shiftChoices.map((s) => (
            <option key={s.id} value={s.id}>
              {type === "pickup" ? `${name(s.user_id)}: ` : ""}
              {shiftLabel(s)}
            </option>
          ))}
        </select>
      </div>

      {type === "swap" && (
        <div className="space-y-1.5 sm:col-span-2">
          <label className="font-medium text-sm" htmlFor="shiftRequestSwap">
            Coworker's shift you'd take in return
          </label>
          <select
            className={inputClass}
            disabled={theirs.length === 0}
            id="shiftRequestSwap"
            onChange={(e) => setSwapShiftId(e.target.value)}
            value={swapShiftId}
          >
            <option value="">
              {theirs.length === 0
                ? "No coworker shifts available"
                : "Choose a shift…"}
            </option>
            {theirs.map((s) => (
              <option key={s.id} value={s.id}>
                {name(s.user_id)}: {shiftLabel(s)}
              </option>
            ))}
          </select>
        </div>
      )}

      {type === "offer" && (
        <div className="space-y-1.5">
          <label className="font-medium text-sm" htmlFor="shiftRequestTarget">
            Offer to
          </label>
          <select
            className={inputClass}
            id="shiftRequestTarget"
            onChange={(e) => setTargetUserId(e.target.value)}
            value={targetUserId}
          >
            <option value="">Anyone</option>
            {coworkers.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
        </div>
      )}

      <div
        className={
          type === "offer" ? "space-y-1.5" : "space-y-1.5 sm:col-span-2"
        }
      >
        <label className="font-medium text-sm" htmlFor="shiftRequestNote">
          Note (optional)
        </label>
        <input
          className={inputClass}
          id="shiftRequestNote"
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Family event"
          value={note}
        />
      </div>

      <div className="sm:col-span-2">
        <Button
          className="w-full sm:w-auto"
          disabled={!canSubmit}
          type="submit"
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {type === "offer" ? "Post shift" : "Send request"}
        </Button>
      </div>
    </form>
  );
}
