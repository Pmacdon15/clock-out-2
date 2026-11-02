"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, Loader2, Palmtree, X } from "lucide-react";
import { use, useState } from "react";
import { toast } from "sonner";
import {
  cancelTimeOffRequestAction,
  createTimeOffRequestAction,
  reviewTimeOffRequestAction,
} from "@/lib/actions";
import {
  DEFAULT_TIME_OFF_HOURS_PER_DAY,
  formatTimeOffDates,
  formatTimeOffHours,
  MAX_TIME_OFF_NOTE_LENGTH,
  TIME_OFF_STATUS_LABELS,
  TIME_OFF_TYPE_LABELS,
  TIME_OFF_TYPES,
  timeOffHoursInRange,
} from "@/lib/time-off-utils";
import type {
  SerializableResult,
  TimeOffRequest,
  TimeOffStatus,
  TimeOffType,
} from "@/lib/types";
import { Button, Card } from "./ui";

type Member = { id: string; name: string };

interface TimeOffProps {
  timeOffPromise: Promise<
    SerializableResult<TimeOffRequest[], { reason: string }>
  >;
  membersPromise?: Promise<Member[]>;
  currentUserIdPromise: Promise<string | null | undefined>;
  isAdmin: boolean;
}

export const TIME_OFF_STATUS_STYLES: Record<TimeOffStatus, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  approved:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  denied: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  cancelled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const inputClass =
  "h-11 w-full rounded-xl border-2 border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950";

type MutationResult = { success: boolean; error?: string };

/** Runs a time off action and toasts the outcome. */
function useTimeOffMutation<A>(
  action: (args: A) => Promise<MutationResult>,
  successMessage: string,
) {
  return useMutation({
    mutationFn: action,
    onSuccess: (res) => {
      if (res.success) toast.success(successMessage);
      else toast.error(res.error);
    },
  });
}

/** Who the form files time off for: "" is the signed-in person. */
const SELF = "";

function RequestForm({
  isAdmin,
  members,
}: {
  isAdmin: boolean;
  members: Member[];
}) {
  const [memberId, setMemberId] = useState(SELF);
  const [approve, setApprove] = useState(true);
  const [type, setType] = useState<TimeOffType>("vacation");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hoursPerDay, setHoursPerDay] = useState(
    DEFAULT_TIME_OFF_HOURS_PER_DAY,
  );
  const [note, setNote] = useState("");

  const { mutate, isPending } = useTimeOffMutation(
    async () => {
      const args = [
        type,
        startDate,
        endDate || startDate,
        hoursPerDay,
        note,
      ] as const;
      const res = await (isAdmin
        ? createTimeOffRequestAction(...args, {
            memberId: memberId || null,
            approve,
          })
        : createTimeOffRequestAction(...args));
      if (res.success) {
        setStartDate("");
        setEndDate("");
        setNote("");
      }
      return res;
    },
    isAdmin && approve ? "Time off added" : "Time off requested",
  );

  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        mutate(undefined);
      }}
    >
      {isAdmin && (
        <div className="space-y-1.5 sm:col-span-2">
          <label className="font-medium text-sm" htmlFor="timeOffMember">
            For
          </label>
          <select
            className={inputClass}
            id="timeOffMember"
            onChange={(e) => setMemberId(e.target.value)}
            value={memberId}
          >
            <option value={SELF}>Myself</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-1.5">
        <label className="font-medium text-sm" htmlFor="timeOffType">
          Type
        </label>
        <select
          className={inputClass}
          id="timeOffType"
          onChange={(e) => setType(e.target.value as TimeOffType)}
          value={type}
        >
          {TIME_OFF_TYPES.map((t) => (
            <option key={t} value={t}>
              {TIME_OFF_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label className="font-medium text-sm" htmlFor="timeOffHours">
          Hours per day
        </label>
        <input
          className={inputClass}
          id="timeOffHours"
          max={24}
          min={0.5}
          onChange={(e) => setHoursPerDay(Number(e.target.value))}
          step={0.5}
          type="number"
          value={hoursPerDay}
        />
      </div>
      <div className="space-y-1.5">
        <label className="font-medium text-sm" htmlFor="timeOffStart">
          From
        </label>
        <input
          className={inputClass}
          id="timeOffStart"
          onChange={(e) => setStartDate(e.target.value)}
          type="date"
          value={startDate}
        />
      </div>
      <div className="space-y-1.5">
        <label className="font-medium text-sm" htmlFor="timeOffEnd">
          To (leave blank for one day)
        </label>
        <input
          className={inputClass}
          id="timeOffEnd"
          min={startDate || undefined}
          onChange={(e) => setEndDate(e.target.value)}
          type="date"
          value={endDate}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <label className="font-medium text-sm" htmlFor="timeOffNote">
          Note (optional)
        </label>
        <input
          className={inputClass}
          id="timeOffNote"
          maxLength={MAX_TIME_OFF_NOTE_LENGTH}
          onChange={(e) => setNote(e.target.value)}
          value={note}
        />
      </div>
      {isAdmin && (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            checked={approve}
            onChange={(e) => setApprove(e.target.checked)}
            type="checkbox"
          />
          Approve right away
        </label>
      )}
      <div className="sm:col-span-2">
        <Button
          className="w-full sm:w-auto"
          disabled={!startDate || isPending}
          type="submit"
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isAdmin && approve ? "Add time off" : "Request time off"}
        </Button>
      </div>
    </form>
  );
}

function RequestRow({
  request,
  memberName,
  canReview,
  canCancel,
}: {
  request: TimeOffRequest;
  memberName?: string;
  canReview: boolean;
  canCancel: boolean;
}) {
  const review = useTimeOffMutation(
    (decision: "approved" | "denied") =>
      reviewTimeOffRequestAction(request.id, decision),
    "Request updated",
  );
  const cancel = useTimeOffMutation(
    () => cancelTimeOffRequestAction(request.id),
    "Request cancelled",
  );
  const busy = review.isPending || cancel.isPending;

  return (
    <li className="flex flex-col gap-1.5 border-zinc-100 border-b py-4 last:border-0 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {memberName && <span className="font-bold">{memberName}</span>}
          <span className="font-medium text-sm">
            {TIME_OFF_TYPE_LABELS[request.request_type]} ·{" "}
            {formatTimeOffDates(request)} ·{" "}
            {formatTimeOffHours(timeOffHoursInRange(request))}
          </span>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 font-semibold text-xs ${TIME_OFF_STATUS_STYLES[request.status]}`}
        >
          {TIME_OFF_STATUS_LABELS[request.status]}
        </span>
      </div>
      {request.note && (
        <p className="text-muted-foreground text-xs italic">{request.note}</p>
      )}
      {(canReview || canCancel) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {canReview && (
            <>
              <Button
                disabled={busy}
                onClick={() => review.mutate("approved")}
                size="sm"
              >
                <Check className="mr-1 h-4 w-4" />
                Approve
              </Button>
              <Button
                disabled={busy}
                onClick={() => review.mutate("denied")}
                size="sm"
                variant="outline"
              >
                <X className="mr-1 h-4 w-4" />
                Deny
              </Button>
            </>
          )}
          {canCancel && (
            <Button
              disabled={busy}
              onClick={() => cancel.mutate(undefined)}
              size="sm"
              variant="ghost"
            >
              {request.status === "approved" ? "Revoke" : "Cancel request"}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export default function TimeOff({
  timeOffPromise,
  membersPromise,
  currentUserIdPromise,
  isAdmin,
}: TimeOffProps) {
  const result = use(timeOffPromise);
  const members = membersPromise ? use(membersPromise) : [];
  const currentUserId = use(currentUserIdPromise);

  if (!result.ok) {
    return (
      <Card className="p-8 text-center text-red-500">
        {"Error fetching time off: "}
        {result.error.reason}
      </Card>
    );
  }

  const memberNames = new Map(members.map((m) => [m.id, m.name]));
  const nameOf = (request: TimeOffRequest) =>
    isAdmin
      ? (memberNames.get(request.user_id) ?? "Unknown member")
      : undefined;
  const canCancel = (request: TimeOffRequest) =>
    (request.status === "pending" && request.user_id === currentUserId) ||
    (isAdmin &&
      (request.status === "pending" || request.status === "approved"));

  const pending = result.value.filter((r) => r.status === "pending");
  const others = isAdmin
    ? result.value.filter((r) => r.status !== "pending")
    : result.value;

  const renderRows = (list: TimeOffRequest[]) => (
    <ul>
      {list.map((request) => (
        <RequestRow
          canCancel={canCancel(request)}
          canReview={isAdmin && request.status === "pending"}
          key={request.id}
          memberName={nameOf(request)}
          request={request}
        />
      ))}
    </ul>
  );

  return (
    <div className="space-y-6 pb-20">
      <Card className="p-6 sm:p-8">
        <div className="mb-6 flex items-start gap-3">
          <div className="rounded-xl bg-zinc-900 p-2 text-white dark:bg-zinc-100 dark:text-black">
            <Palmtree className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-2xl tracking-tight">Time off</h3>
            <p className="text-muted-foreground text-sm">
              {isAdmin
                ? "Add vacation or sick days for yourself or any member, and approve, deny or revoke requests. Approved time off shows in the Hours view and in hours reports."
                : "Request vacation or sick days. Once an admin approves them they show in the Hours view and in hours reports."}
            </p>
          </div>
        </div>
        <RequestForm isAdmin={isAdmin} members={members} />
      </Card>

      {isAdmin && (
        <Card className="p-6 sm:p-8">
          <h4 className="mb-2 font-bold text-lg">Waiting for approval</h4>
          {pending.length === 0 ? (
            <p className="py-4 text-muted-foreground text-sm">
              No requests waiting.
            </p>
          ) : (
            renderRows(pending)
          )}
        </Card>
      )}

      <Card className="p-6 sm:p-8">
        <h4 className="mb-2 font-bold text-lg">
          {isAdmin ? "All requests" : "My requests"}
        </h4>
        {others.length === 0 ? (
          <p className="py-4 text-muted-foreground text-sm">No time off yet.</p>
        ) : (
          renderRows(others)
        )}
      </Card>
    </div>
  );
}
