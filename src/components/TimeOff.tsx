"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, Loader2, Palmtree, X } from "lucide-react";
import { use, useState } from "react";
import { toast } from "sonner";
import {
  cancelTimeOffRequestAction,
  createTimeOffRequestAction,
  reviewTimeOffRequestAction,
  setTimeOffAllowanceAction,
} from "@/lib/actions";
import {
  DEFAULT_TIME_OFF_HOURS_PER_DAY,
  formatDays,
  formatTimeOffDates,
  formatTimeOffHours,
  MAX_PTO_DAYS,
  MAX_TIME_OFF_NOTE_LENGTH,
  ptoDaysUsed,
  TIME_OFF_STATUS_LABELS,
  TIME_OFF_TYPE_LABELS,
  TIME_OFF_TYPES,
  timeOffHoursInRange,
} from "@/lib/time-off-utils";
import type {
  SerializableResult,
  TimeOffAllowance,
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
  /** Yearly PTO days per member; members without one have no limit. */
  allowancesPromise?: Promise<
    SerializableResult<TimeOffAllowance[], { reason: string }>
  >;
  membersPromise?: Promise<Member[]>;
  currentUserIdPromise: Promise<string | null | undefined>;
  isAdmin: boolean;
}

/** A member's PTO for one calendar year, in days. */
type PtoBalance = {
  allowance: number;
  used: number;
  pending: number;
  left: number;
};

function ptoBalance(
  requests: TimeOffRequest[],
  userId: string,
  allowance: number,
  year: number,
): PtoBalance {
  const used = ptoDaysUsed(requests, userId, year, ["approved"]);
  const pending = ptoDaysUsed(requests, userId, year, ["pending"]);
  return { allowance, used, pending, left: allowance - used - pending };
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

function RequestForm({ ptoHint }: { ptoHint?: string }) {
  const [type, setType] = useState<TimeOffType>("vacation");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hoursPerDay, setHoursPerDay] = useState(
    DEFAULT_TIME_OFF_HOURS_PER_DAY,
  );
  const [note, setNote] = useState("");

  const { mutate, isPending } = useTimeOffMutation(async () => {
    const res = await createTimeOffRequestAction(
      type,
      startDate,
      endDate || startDate,
      hoursPerDay,
      note,
    );
    if (res.success) {
      setStartDate("");
      setEndDate("");
      setNote("");
    }
    return res;
  }, "Time off requested");

  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        mutate(undefined);
      }}
    >
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
        {type === "vacation" && ptoHint && (
          <p className="text-muted-foreground text-xs">{ptoHint}</p>
        )}
        {type === "unpaid" && (
          <p className="text-muted-foreground text-xs">
            Unpaid time off doesn't use your PTO and isn't paid.
          </p>
        )}
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
      <div className="sm:col-span-2">
        <Button
          className="w-full sm:w-auto"
          disabled={!startDate || isPending}
          type="submit"
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Request time off
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

function PtoBalanceCard({
  balance,
  year,
}: {
  balance: PtoBalance;
  year: number;
}) {
  return (
    <Card className="p-6 sm:p-8">
      <h4 className="mb-4 font-bold text-lg">My PTO for {year}</h4>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Per year", balance.allowance],
          ["Used", balance.used],
          ["Pending", balance.pending],
          ["Left", Math.max(0, balance.left)],
        ].map(([label, days]) => (
          <div key={label}>
            <dt className="text-muted-foreground text-xs uppercase">{label}</dt>
            <dd className="font-bold text-2xl tabular-nums">
              {formatDays(days as number)}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function AllowanceRow({
  member,
  allowance,
  balance,
}: {
  member: Member;
  allowance: number | null;
  balance: PtoBalance | null;
}) {
  const [value, setValue] = useState(allowance === null ? "" : `${allowance}`);
  const save = useTimeOffMutation(
    (days: number | null) => setTimeOffAllowanceAction(member.id, days),
    "PTO allowance saved",
  );
  const trimmed = value.trim();
  const days = trimmed === "" ? null : Number(trimmed);
  const unchanged = days === allowance;
  const inputId = `pto-${member.id}`;

  return (
    <li className="flex flex-col gap-2 border-zinc-100 border-b py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
      <div>
        <label className="font-bold" htmlFor={inputId}>
          {member.name}
        </label>
        <p className="text-muted-foreground text-xs">
          {balance
            ? `${formatDays(balance.used)} used · ${formatDays(balance.pending)} pending · ${formatDays(Math.max(0, balance.left))} left`
            : "No PTO limit"}
        </p>
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(days);
        }}
      >
        <input
          aria-label={`PTO days per year for ${member.name}`}
          className={`${inputClass} w-28`}
          id={inputId}
          max={MAX_PTO_DAYS}
          min={0}
          onChange={(e) => setValue(e.target.value)}
          placeholder="No limit"
          step={0.5}
          type="number"
          value={value}
        />
        <span className="text-muted-foreground text-sm">days/yr</span>
        <Button disabled={unchanged || save.isPending} size="sm" type="submit">
          {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </form>
    </li>
  );
}

function AllowancesCard({
  members,
  allowances,
  requests,
  year,
}: {
  members: Member[];
  allowances: Map<string, number>;
  requests: TimeOffRequest[];
  year: number;
}) {
  return (
    <Card className="p-6 sm:p-8">
      <h4 className="font-bold text-lg">PTO days per employee</h4>
      <p className="mb-2 text-muted-foreground text-sm">
        Paid vacation days each member gets per calendar year ({year} shown).
        Leave blank for no limit. Sick days and unpaid time off don't use PTO.
      </p>
      {members.length === 0 ? (
        <p className="py-4 text-muted-foreground text-sm">No members yet.</p>
      ) : (
        <ul>
          {members.map((member) => {
            const allowance = allowances.get(member.id) ?? null;
            return (
              <AllowanceRow
                allowance={allowance}
                balance={
                  allowance === null
                    ? null
                    : ptoBalance(requests, member.id, allowance, year)
                }
                key={`${member.id}:${allowance}`}
                member={member}
              />
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default function TimeOff({
  timeOffPromise,
  allowancesPromise,
  membersPromise,
  currentUserIdPromise,
  isAdmin,
}: TimeOffProps) {
  const result = use(timeOffPromise);
  const allowancesResult = allowancesPromise ? use(allowancesPromise) : null;
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

  const year = new Date().getFullYear();
  const allowances = new Map(
    (allowancesResult?.ok ? allowancesResult.value : []).map((a) => [
      a.user_id,
      Number(a.pto_days),
    ]),
  );
  const myAllowance = currentUserId ? allowances.get(currentUserId) : undefined;
  const myBalance =
    currentUserId && myAllowance !== undefined
      ? ptoBalance(result.value, currentUserId, myAllowance, year)
      : null;

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
              Request vacation (PTO), sick days or unpaid time off. Once an
              admin approves them they show in the Hours view and in hours
              reports.
            </p>
          </div>
        </div>
        <RequestForm
          ptoHint={
            myBalance
              ? `${formatDays(Math.max(0, myBalance.left))} of PTO left for ${year}`
              : undefined
          }
        />
      </Card>

      {myBalance && <PtoBalanceCard balance={myBalance} year={year} />}

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

      {isAdmin && allowancesResult?.ok && (
        <AllowancesCard
          allowances={allowances}
          members={members}
          requests={result.value}
          year={year}
        />
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
