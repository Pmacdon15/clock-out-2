"use client";

import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeftRight, Check, X } from "lucide-react";
import { use } from "react";
import { toast } from "sonner";
import {
  approveShiftRequestAction,
  cancelShiftRequestAction,
  claimShiftRequestAction,
  denyShiftRequestAction,
} from "@/lib/shift-request-actions";
import {
  canCancelShiftRequest,
  canClaimShiftRequest,
  groupShiftRequestsFor,
  SHIFT_REQUEST_STATUS_LABELS,
  SHIFT_REQUEST_TYPE_LABELS,
} from "@/lib/shift-request-utils";
import type { ShiftRequestsView } from "@/lib/shift-requests-dal";
import type { SerializableResult, ShiftRequestDetail } from "@/lib/types";
import { Button, Card } from "./ui";

interface ShiftRequestsProps {
  viewPromise: Promise<
    SerializableResult<ShiftRequestsView, { reason: string }>
  >;
}

type ActionResult = { success: boolean; error?: string };

const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const formatRange = (start: Date | string, end: Date | string) =>
  `${format(new Date(start), "EEE, MMM d, h:mm a")} – ${format(new Date(end), "h:mm a")}`;

function useRequestMutation(
  action: (id: number, timezone?: string | null) => Promise<ActionResult>,
  successMessage: string,
) {
  return useMutation({
    mutationFn: (id: number) => action(id, browserTimezone()),
    onSuccess: (res) => {
      if (res.success) toast.success(successMessage);
      else toast.error(res.error);
    },
  });
}

function RequestRow({
  request,
  names,
  canClaim,
  canCancel,
  canReview,
}: {
  request: ShiftRequestDetail;
  names: Record<string, string>;
  canClaim: boolean;
  canCancel: boolean;
  canReview: boolean;
}) {
  const claim = useRequestMutation(
    claimShiftRequestAction,
    request.request_type === "offer" ? "Shift claimed" : "Request accepted",
  );
  const cancel = useRequestMutation(cancelShiftRequestAction, "Request closed");
  const approve = useRequestMutation(
    approveShiftRequestAction,
    "Approved: the schedule is updated",
  );
  const deny = useRequestMutation(denyShiftRequestAction, "Request denied");
  const busy =
    claim.isPending || cancel.isPending || approve.isPending || deny.isPending;
  const name = (id: string | null) => (id && names[id]) || "A team member";
  // The coworker a pickup or swap was sent to declines rather than cancels.
  const declines = canClaim && request.request_type !== "offer";

  return (
    <li className="flex flex-col gap-1.5 border-zinc-100 border-b py-4 last:border-0 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">
          {SHIFT_REQUEST_TYPE_LABELS[request.request_type]}
        </span>
        <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 font-semibold text-xs dark:bg-zinc-800">
          {SHIFT_REQUEST_STATUS_LABELS[request.status]}
        </span>
      </div>
      <p className="text-sm">
        {name(request.shift_owner)}:{" "}
        {formatRange(request.shift_start, request.shift_end)}
        {request.claimed_by && <> → {name(request.claimed_by)}</>}
      </p>
      {request.swap_shift_start && request.swap_shift_end && (
        <p className="text-sm">
          In return, {name(request.swap_shift_owner)}:{" "}
          {formatRange(request.swap_shift_start, request.swap_shift_end)} →{" "}
          {name(request.requested_by)}
        </p>
      )}
      {request.note && (
        <p className="text-muted-foreground text-xs italic">{request.note}</p>
      )}
      {(canClaim || canCancel || canReview) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {canClaim && (
            <Button
              disabled={busy}
              onClick={() => claim.mutate(request.id)}
              size="sm"
            >
              <Check className="mr-1 h-4 w-4" />
              {request.request_type === "offer" ? "Claim" : "Accept"}
            </Button>
          )}
          {canReview && (
            <>
              <Button
                disabled={busy}
                onClick={() => approve.mutate(request.id)}
                size="sm"
              >
                <Check className="mr-1 h-4 w-4" />
                Approve
              </Button>
              <Button
                disabled={busy}
                onClick={() => deny.mutate(request.id)}
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
              onClick={() => cancel.mutate(request.id)}
              size="sm"
              variant="ghost"
            >
              {declines ? "Decline" : "Cancel request"}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function Section({
  title,
  requests,
  view,
}: {
  title: string;
  requests: ShiftRequestDetail[];
  view: ShiftRequestsView;
}) {
  if (requests.length === 0) return null;
  return (
    <section>
      <h4 className="mt-4 font-semibold text-muted-foreground text-sm uppercase">
        {title}
      </h4>
      <ul>
        {requests.map((r) => (
          <RequestRow
            canCancel={canCancelShiftRequest(r, view.userId, view.isAdmin)}
            canClaim={canClaimShiftRequest(r, view.userId)}
            canReview={view.isAdmin && r.status === "pending_approval"}
            key={r.id}
            names={view.names}
            request={r}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Shift swaps and pickups: shifts coworkers have posted, requests waiting
 * for your answer, your own requests, and (for admins) changes to approve.
 * New requests are made through the AI assistant (MCP).
 */
export default function ShiftRequests({ viewPromise }: ShiftRequestsProps) {
  const result = use(viewPromise);
  if (!result.ok) {
    return (
      <Card className="p-8 text-center text-red-500">
        {result.error.reason}
      </Card>
    );
  }
  const view = result.value;
  const groups = groupShiftRequestsFor(view.requests, view.userId);
  const toApprove = view.isAdmin
    ? view.requests.filter((r) => r.status === "pending_approval")
    : [];
  const mine = groups.yours.filter((r) => !toApprove.includes(r));

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex items-center gap-2">
        <ArrowLeftRight className="h-5 w-5" />
        <h3 className="font-bold text-xl tracking-tight">Shift swaps</h3>
      </div>
      <p className="mt-1 text-muted-foreground text-sm">
        Ask your AI assistant to post, swap or pick up a shift. Changes reach
        the schedule once a manager approves them.
      </p>
      {view.requests.length === 0 ? (
        <p className="py-4 text-muted-foreground text-sm">
          No open swaps or pickups right now.
        </p>
      ) : (
        <>
          <Section
            requests={toApprove}
            title="Waiting for your approval"
            view={view}
          />
          <Section
            requests={groups.awaitingYou}
            title="Waiting for your answer"
            view={view}
          />
          <Section
            requests={groups.available}
            title="Up for grabs"
            view={view}
          />
          <Section requests={mine} title="Your requests" view={view} />
        </>
      )}
    </Card>
  );
}
