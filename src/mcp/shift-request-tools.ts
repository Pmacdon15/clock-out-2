import { addDays, subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { dbGetScheduledShifts } from "@/lib/db";
import {
  orgHasPlanFeature,
  SCHEDULING_FEATURE,
  SCHEDULING_UPGRADE_REASON,
} from "@/lib/plan-features";
import {
  mirrorReassignedShifts,
  notifyShiftRequest,
} from "@/lib/shift-request-notify";
import {
  cancelShiftRequest,
  claimShiftRequest,
  createShiftRequest,
  groupShiftRequestsFor,
  reviewShiftRequest,
  SHIFT_REQUEST_STATUS_LABELS,
  SHIFT_REQUEST_TYPE_LABELS,
  type ShiftRequestActor,
  type ShiftRequestFailure,
} from "@/lib/shift-requests";
import {
  ACTIVE_SHIFT_REQUEST_STATUSES,
  dbGetShiftRequest,
  dbListShiftRequests,
} from "@/lib/shift-requests-db";
import type {
  ScheduledShift,
  ShiftRequest,
  ShiftRequestDetail,
  ShiftRequestType,
} from "@/lib/types";
import {
  fetchOrgMembers,
  formatTimestampInTz,
  type McpCaller,
  type OrgContext,
  type OrgMemberInfo,
  parseFlexibleDateTime,
  resolveOrg,
  type ToolResult,
  validTimezone,
} from "@/mcp/tools";

/*
 * Shift swap and pickup requests from MCP: members offer their shifts, ask
 * coworkers to swap or to hand one over, and claim or accept what's offered;
 * admins approve (which moves the shifts in the schedule) or deny. The rules
 * live in src/lib/shift-requests.ts and are the same as on the Schedule page.
 */

/* ---------------------------------------------------------- schemas -- */

const orgIdField = z
  .string()
  .optional()
  .describe(
    "Organization ID (org_...), slug, or name. Optional if the user only belongs to one organization.",
  );

const timezoneField = z
  .string()
  .optional()
  .describe(
    "IANA timezone name (e.g. 'America/Edmonton') used to read `date` and show times. Defaults to 'America/Edmonton'.",
  );

const dateField = (description: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .describe(description);

const requestIdField = z
  .number()
  .int()
  .describe(
    "ID of the shift request (request_id from list_open_shifts or list_pending_shift_requests).",
  );

const noteField = z
  .string()
  .optional()
  .describe(
    "Optional note for the coworker and manager, up to 500 characters.",
  );

export const postShiftForPickupInputSchema = z.object({
  org_id: orgIdField,
  shift_id: z
    .number()
    .int()
    .optional()
    .describe(
      "ID of your scheduled shift to give up (from manage_schedule action 'list'). Or pass date instead.",
    ),
  date: dateField(
    "Day of your shift (YYYY-MM-DD in `timezone`), when you have exactly one shift that day. Used when shift_id is omitted.",
  ),
  offer_to: z
    .string()
    .optional()
    .describe(
      "Optional: a coworker's name, email, or user_id. Only they can claim it. Omit to let any coworker claim it.",
    ),
  note: noteField,
  timezone: timezoneField,
});

export const requestShiftSwapInputSchema = z.object({
  org_id: orgIdField,
  shift_id: z
    .number()
    .int()
    .optional()
    .describe("ID of your shift to trade away. Or pass date."),
  date: dateField(
    "Day of your shift to trade (YYYY-MM-DD), when you have exactly one that day.",
  ),
  coworker: z
    .string()
    .describe("The coworker to swap with: their name, email, or user_id."),
  their_shift_id: z
    .number()
    .int()
    .optional()
    .describe(
      "ID of the coworker's shift you'd take in return. Or pass their_date.",
    ),
  their_date: dateField(
    "Day of the coworker's shift you'd take (YYYY-MM-DD), when they have exactly one that day.",
  ),
  note: noteField,
  timezone: timezoneField,
});

export const requestShiftPickupInputSchema = z.object({
  org_id: orgIdField,
  coworker: z
    .string()
    .describe(
      "The coworker whose shift you'd like to take: name, email, or user_id.",
    ),
  shift_id: z
    .number()
    .int()
    .optional()
    .describe("ID of the coworker's shift. Or pass date."),
  date: dateField(
    "Day of the coworker's shift (YYYY-MM-DD), when they have exactly one that day.",
  ),
  note: noteField,
  timezone: timezoneField,
});

export const listOpenShiftsInputSchema = z.object({
  org_id: orgIdField,
  timezone: timezoneField,
});

export const claimShiftInputSchema = z.object({
  org_id: orgIdField,
  request_id: requestIdField,
  timezone: timezoneField,
});

export const cancelShiftRequestInputSchema = z.object({
  org_id: orgIdField,
  request_id: requestIdField,
  timezone: timezoneField,
});

export const listPendingShiftRequestsInputSchema = z.object({
  org_id: orgIdField,
  include_open: z
    .boolean()
    .optional()
    .describe(
      "Also list requests still waiting for a coworker (status 'open'). Defaults to false: only requests waiting for a manager.",
    ),
  timezone: timezoneField,
});

export const reviewShiftRequestInputSchema = z.object({
  org_id: orgIdField,
  request_id: requestIdField,
  note: z
    .string()
    .optional()
    .describe("Optional note for the members involved, up to 500 characters."),
  timezone: timezoneField,
});

/* ---------------------------------------------------------- helpers -- */

const LIST_LOOKBACK_DAYS = 1;

function revalidate(...tags: string[]) {
  for (const tag of tags) {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch (error) {
      console.warn("Cache invalidation warning:", error);
    }
  }
}

function orgInfo(org: OrgContext) {
  return { org_id: org.orgId, name: org.orgName };
}

function failure(result: ShiftRequestFailure): ToolResult {
  return {
    summary: result.reason,
    data: { status: result.status },
    isError: true,
  };
}

const invalid = (summary: string, data: Record<string, unknown> = {}) =>
  ({
    summary,
    data: { status: "invalid_input", ...data },
    isError: true,
  }) satisfies ToolResult;

function describeRange(start: Date | string, end: Date | string, tz: string) {
  return `${formatInTimeZone(new Date(start), tz, "EEE, MMM d, h:mm a")} – ${formatInTimeZone(new Date(end), tz, "h:mm a zzz")}`;
}

/** The request as tools return it, with names and local times. */
export function formatShiftRequest(
  request: ShiftRequestDetail,
  tz: string,
  names: Map<string, string>,
) {
  const name = (id: string | null) =>
    id ? (names.get(id) ?? "Unknown member") : null;
  return {
    request_id: request.id,
    type: request.request_type,
    type_label: SHIFT_REQUEST_TYPE_LABELS[request.request_type],
    status: request.status,
    status_label: SHIFT_REQUEST_STATUS_LABELS[request.status],
    shift: {
      shift_id: request.shift_id,
      owner: name(request.shift_owner),
      when: describeRange(request.shift_start, request.shift_end, tz),
      shift_start: new Date(request.shift_start).toISOString(),
      shift_end: new Date(request.shift_end).toISOString(),
      note: request.shift_note,
    },
    swap_shift:
      request.swap_shift_id &&
      request.swap_shift_start &&
      request.swap_shift_end
        ? {
            shift_id: request.swap_shift_id,
            owner: name(request.swap_shift_owner),
            when: describeRange(
              request.swap_shift_start,
              request.swap_shift_end,
              tz,
            ),
            shift_start: new Date(request.swap_shift_start).toISOString(),
            shift_end: new Date(request.swap_shift_end).toISOString(),
          }
        : null,
    requested_by: name(request.requested_by),
    sent_to: name(request.target_user_id),
    taking_shift: name(request.claimed_by),
    note: request.note,
    claimed_at: formatTimestampInTz(request.claimed_at, tz),
    reviewed_by: name(request.reviewed_by),
    reviewed_at: formatTimestampInTz(request.reviewed_at, tz),
    review_note: request.review_note,
  };
}

/** Finds a coworker by name, email or user_id (any member may look up any). */
export function findCoworker(
  members: OrgMemberInfo[],
  requested: string,
): { ok: true; member: OrgMemberInfo } | { ok: false; result: ToolResult } {
  const needle = requested.trim().toLowerCase();
  const exact = members.filter(
    (m) =>
      m.userId.toLowerCase() === needle ||
      m.email?.toLowerCase() === needle ||
      m.name.toLowerCase() === needle,
  );
  const matches =
    exact.length > 0
      ? exact
      : members.filter(
          (m) =>
            m.firstName?.toLowerCase() === needle ||
            m.lastName?.toLowerCase() === needle ||
            m.name.toLowerCase().includes(needle),
        );
  if (matches.length === 1) return { ok: true, member: matches[0] };
  if (matches.length > 1) {
    return {
      ok: false,
      result: {
        summary: `More than one coworker matched "${requested}": ${matches.map((m) => m.name).join(", ")}. Use their full name or email.`,
        data: {
          status: "ambiguous_member",
          matches: matches.map((m) => ({ user_id: m.userId, name: m.name })),
        },
        isError: true,
      },
    };
  }
  return {
    ok: false,
    result: {
      summary: `No coworker matching "${requested}" was found in this organization.`,
      data: { status: "member_not_found" },
      isError: true,
    },
  };
}

/** The org, checked for the Scheduling plan feature, and its members. */
async function setup(
  caller: McpCaller,
  orgIdInput: string | undefined,
): Promise<
  | {
      ok: true;
      org: OrgContext;
      actor: ShiftRequestActor;
      members: OrgMemberInfo[];
      names: Map<string, string>;
    }
  | { ok: false; result: ToolResult }
> {
  const orgRes = await resolveOrg(caller.userId, orgIdInput);
  if (!orgRes.ok) return orgRes;
  const { org } = orgRes;
  if (!(await orgHasPlanFeature(org.orgId, SCHEDULING_FEATURE))) {
    return {
      ok: false,
      result: {
        summary: SCHEDULING_UPGRADE_REASON,
        data: { status: "scheduling_not_enabled" },
        isError: true,
      },
    };
  }
  const members = await fetchOrgMembers(org.orgId);
  return {
    ok: true,
    org,
    actor: { userId: caller.userId, orgId: org.orgId, isAdmin: org.isAdmin },
    members,
    names: new Map(members.map((m) => [m.userId, m.name])),
  };
}

/**
 * The shift to act on: `shiftId`, or the member's only shift on `date`.
 * Only the id is resolved here; ownership is checked by the shared rules.
 */
async function resolveShiftId(
  orgId: string,
  userId: string,
  whose: string,
  shiftId: number | undefined,
  date: string | undefined,
  tz: string,
  idField: string,
  dateField: string,
): Promise<{ ok: true; shiftId: number } | { ok: false; result: ToolResult }> {
  if (shiftId !== undefined) return { ok: true, shiftId };
  if (!date) {
    return {
      ok: false,
      result: invalid(`Pass ${idField}, or ${dateField} (YYYY-MM-DD).`),
    };
  }
  const dayStart = parseFlexibleDateTime("00:00", tz, date) as Date;
  const sameDay: ScheduledShift[] = await dbGetScheduledShifts(
    orgId,
    userId,
    dayStart,
    addDays(dayStart, 1),
  );
  if (sameDay.length !== 1) {
    return {
      ok: false,
      result: invalid(
        sameDay.length === 0
          ? `${whose} no shift on ${date}.`
          : `${whose} ${sameDay.length} shifts on ${date}; pass ${idField} to pick one.`,
        {
          shifts: sameDay.map((s) => ({
            shift_id: s.id,
            when: describeRange(s.shift_start, s.shift_end, tz),
          })),
        },
      ),
    };
  }
  return { ok: true, shiftId: sameDay[0].id };
}

/** Reloads a request with its shift details for the response. */
async function detailOf(request: ShiftRequest, orgId: string) {
  return (await dbGetShiftRequest(request.id, orgId)) as ShiftRequestDetail;
}

const shiftOf = (detail: ShiftRequestDetail) => ({
  shift_start: detail.shift_start,
  shift_end: detail.shift_end,
});

/* ------------------------------------------------------------ create -- */

async function create(
  caller: McpCaller,
  input: {
    org_id?: string;
    timezone?: string;
    note?: string;
  },
  type: ShiftRequestType,
  pick: (ctx: {
    org: OrgContext;
    members: OrgMemberInfo[];
    tz: string;
  }) => Promise<
    | {
        ok: true;
        shiftId: number;
        swapShiftId?: number;
        targetUserId?: string;
      }
    | { ok: false; result: ToolResult }
  >,
): Promise<ToolResult> {
  const ctx = await setup(caller, input.org_id);
  if (!ctx.ok) return ctx.result;
  const tz = validTimezone(input.timezone);
  const picked = await pick({ org: ctx.org, members: ctx.members, tz });
  if (!picked.ok) return picked.result;

  const created = await createShiftRequest(ctx.actor, {
    type,
    shiftId: picked.shiftId,
    swapShiftId: picked.swapShiftId ?? null,
    targetUserId: picked.targetUserId ?? null,
    note: input.note,
  });
  if (!created.ok) return failure(created);
  const detail = await detailOf(created.value, ctx.org.orgId);
  await notifyShiftRequest(
    "created",
    created.value,
    shiftOf(detail),
    caller.userId,
    tz,
  );
  const formatted = formatShiftRequest(detail, tz, ctx.names);
  const summary =
    type === "offer"
      ? `Posted your shift ${formatted.shift.when} for ${formatted.sent_to ?? "any coworker"} to pick up. Once someone claims it, a manager approves the change.`
      : type === "swap"
        ? `Asked ${formatted.sent_to} to swap: your ${formatted.shift.when} for their ${formatted.swap_shift?.when}. If they accept, a manager approves the swap.`
        : `Asked ${formatted.sent_to} to let you take their shift ${formatted.shift.when}. If they accept, a manager approves the change.`;
  return {
    summary,
    data: {
      status: "open",
      organization: orgInfo(ctx.org),
      request: formatted,
    },
  };
}

export async function postShiftForPickupTool(
  caller: McpCaller,
  input: z.infer<typeof postShiftForPickupInputSchema>,
): Promise<ToolResult> {
  return create(caller, input, "offer", async ({ org, members, tz }) => {
    let targetUserId: string | undefined;
    if (input.offer_to?.trim()) {
      const res = findCoworker(members, input.offer_to);
      if (!res.ok) return res;
      targetUserId = res.member.userId;
    }
    const shift = await resolveShiftId(
      org.orgId,
      caller.userId,
      "You have",
      input.shift_id,
      input.date,
      tz,
      "shift_id",
      "date",
    );
    return shift.ok ? { ...shift, targetUserId } : shift;
  });
}

export async function requestShiftSwapTool(
  caller: McpCaller,
  input: z.infer<typeof requestShiftSwapInputSchema>,
): Promise<ToolResult> {
  return create(caller, input, "swap", async ({ org, members, tz }) => {
    const res = findCoworker(members, input.coworker);
    if (!res.ok) return res;
    const mine = await resolveShiftId(
      org.orgId,
      caller.userId,
      "You have",
      input.shift_id,
      input.date,
      tz,
      "shift_id",
      "date",
    );
    if (!mine.ok) return mine;
    const theirs = await resolveShiftId(
      org.orgId,
      res.member.userId,
      `${res.member.name} has`,
      input.their_shift_id,
      input.their_date,
      tz,
      "their_shift_id",
      "their_date",
    );
    if (!theirs.ok) return theirs;
    return { ok: true, shiftId: mine.shiftId, swapShiftId: theirs.shiftId };
  });
}

export async function requestShiftPickupTool(
  caller: McpCaller,
  input: z.infer<typeof requestShiftPickupInputSchema>,
): Promise<ToolResult> {
  return create(caller, input, "pickup", async ({ org, members, tz }) => {
    const res = findCoworker(members, input.coworker);
    if (!res.ok) return res;
    return resolveShiftId(
      org.orgId,
      res.member.userId,
      `${res.member.name} has`,
      input.shift_id,
      input.date,
      tz,
      "shift_id",
      "date",
    );
  });
}

/* -------------------------------------------------------------- list -- */

export async function listOpenShiftsTool(
  caller: McpCaller,
  input: z.infer<typeof listOpenShiftsInputSchema>,
): Promise<ToolResult> {
  const ctx = await setup(caller, input.org_id);
  if (!ctx.ok) return ctx.result;
  const tz = validTimezone(input.timezone);
  const requests = await dbListShiftRequests(
    ctx.org.orgId,
    ACTIVE_SHIFT_REQUEST_STATUSES,
    subDays(new Date(), LIST_LOOKBACK_DAYS),
  );
  const now = Date.now();
  const upcoming = requests.filter(
    (r) => new Date(r.shift_start).getTime() > now,
  );
  const groups = groupShiftRequestsFor(upcoming, caller.userId);
  const fmt = (list: ShiftRequestDetail[]) =>
    list.map((r) => formatShiftRequest(r, tz, ctx.names));
  return {
    summary: `${groups.available.length} open shift${groups.available.length === 1 ? "" : "s"} you can claim, ${groups.awaitingYou.length} request${groups.awaitingYou.length === 1 ? "" : "s"} waiting for your answer, and ${groups.yours.length} of your own in progress.`,
    data: {
      organization: orgInfo(ctx.org),
      available_to_claim: fmt(groups.available),
      awaiting_your_answer: fmt(groups.awaitingYou),
      your_requests: fmt(groups.yours),
    },
  };
}

export async function listPendingShiftRequestsTool(
  caller: McpCaller,
  input: z.infer<typeof listPendingShiftRequestsInputSchema>,
): Promise<ToolResult> {
  const ctx = await setup(caller, input.org_id);
  if (!ctx.ok) return ctx.result;
  if (!ctx.org.isAdmin) {
    return {
      summary:
        "Only organization admins (org:admin) can see shift requests waiting for approval. Use list_open_shifts for your own.",
      data: { status: "forbidden" },
      isError: true,
    };
  }
  const tz = validTimezone(input.timezone);
  const requests = await dbListShiftRequests(
    ctx.org.orgId,
    input.include_open ? ACTIVE_SHIFT_REQUEST_STATUSES : ["pending_approval"],
    subDays(new Date(), LIST_LOOKBACK_DAYS),
  );
  const pending = requests.filter((r) => r.status === "pending_approval");
  return {
    summary:
      requests.length === 0
        ? "No shift requests are waiting for approval."
        : `${pending.length} shift request${pending.length === 1 ? "" : "s"} waiting for approval${input.include_open ? `, ${requests.length - pending.length} still waiting for a coworker` : ""}.`,
    data: {
      organization: orgInfo(ctx.org),
      requests: requests.map((r) => formatShiftRequest(r, tz, ctx.names)),
    },
  };
}

/* ---------------------------------------------------- claim / cancel -- */

export async function claimShiftTool(
  caller: McpCaller,
  input: z.infer<typeof claimShiftInputSchema>,
): Promise<ToolResult> {
  const ctx = await setup(caller, input.org_id);
  if (!ctx.ok) return ctx.result;
  const tz = validTimezone(input.timezone);
  const claimed = await claimShiftRequest(ctx.actor, input.request_id);
  if (!claimed.ok) return failure(claimed);
  const detail = await detailOf(claimed.value, ctx.org.orgId);
  await notifyShiftRequest(
    "claimed",
    claimed.value,
    shiftOf(detail),
    caller.userId,
    tz,
  );
  const formatted = formatShiftRequest(detail, tz, ctx.names);
  return {
    summary: `${claimed.value.request_type === "offer" ? "Claimed" : "Accepted"} ${formatted.type_label.toLowerCase()} for ${formatted.shift.when}. It now waits for a manager's approval; the schedule changes once it's approved.`,
    data: {
      status: "pending_approval",
      organization: orgInfo(ctx.org),
      request: formatted,
    },
  };
}

export async function cancelShiftRequestTool(
  caller: McpCaller,
  input: z.infer<typeof cancelShiftRequestInputSchema>,
): Promise<ToolResult> {
  const ctx = await setup(caller, input.org_id);
  if (!ctx.ok) return ctx.result;
  const tz = validTimezone(input.timezone);
  const cancelled = await cancelShiftRequest(ctx.actor, input.request_id);
  if (!cancelled.ok) return failure(cancelled);
  const detail = await detailOf(cancelled.value, ctx.org.orgId);
  await notifyShiftRequest(
    "cancelled",
    cancelled.value,
    shiftOf(detail),
    caller.userId,
    tz,
  );
  const formatted = formatShiftRequest(detail, tz, ctx.names);
  const declined = cancelled.value.requested_by !== caller.userId;
  return {
    summary: `${declined && !ctx.org.isAdmin ? "Declined" : "Cancelled"} the ${formatted.type_label.toLowerCase()} for ${formatted.shift.when}. The schedule is unchanged.`,
    data: {
      status: "cancelled",
      organization: orgInfo(ctx.org),
      request: formatted,
    },
  };
}

/* ------------------------------------------------------------ review -- */

async function review(
  caller: McpCaller,
  input: z.infer<typeof reviewShiftRequestInputSchema>,
  decision: "approved" | "denied",
): Promise<ToolResult> {
  const ctx = await setup(caller, input.org_id);
  if (!ctx.ok) return ctx.result;
  const tz = validTimezone(input.timezone);
  const reviewed = await reviewShiftRequest(
    ctx.actor,
    input.request_id,
    decision,
    input.note,
  );
  if (!reviewed.ok) return failure(reviewed);

  if (reviewed.decision === "denied") {
    const detail = await detailOf(reviewed.value, ctx.org.orgId);
    await notifyShiftRequest(
      "denied",
      reviewed.value,
      shiftOf(detail),
      caller.userId,
      tz,
    );
    const formatted = formatShiftRequest(detail, tz, ctx.names);
    return {
      summary: `Denied the ${formatted.type_label.toLowerCase()} for ${formatted.shift.when}. The schedule is unchanged.`,
      data: {
        status: "denied",
        organization: orgInfo(ctx.org),
        request: formatted,
      },
    };
  }

  const { request, shifts, previous, superseded } = reviewed.value;
  revalidate(`scheduled-shifts-${ctx.org.orgId}`);
  const detail = await detailOf(request, ctx.org.orgId);
  await Promise.all([
    notifyShiftRequest("approved", request, shiftOf(detail), caller.userId, tz),
    mirrorReassignedShifts(previous, shifts),
  ]);
  const formatted = formatShiftRequest(detail, tz, ctx.names);
  const moves = shifts.map((s) => ({
    shift_id: s.id,
    when: describeRange(s.shift_start, s.shift_end, tz),
    from:
      ctx.names.get(previous.find((p) => p.id === s.id)?.user_id ?? "") ??
      "Unknown member",
    to: ctx.names.get(s.user_id) ?? "Unknown member",
    user_id: s.user_id,
  }));
  return {
    summary: `Approved. ${moves.map((m) => `${m.when} moved from ${m.from} to ${m.to}`).join("; ")}.${superseded.length > 0 ? ` ${superseded.length} other request${superseded.length === 1 ? "" : "s"} for the same shift${superseded.length === 1 ? " was" : "s were"} cancelled.` : ""}`,
    data: {
      status: "approved",
      organization: orgInfo(ctx.org),
      request: formatted,
      reassigned_shifts: moves,
      cancelled_request_ids: superseded.map((r) => r.id),
    },
  };
}

export function approveShiftRequestTool(
  caller: McpCaller,
  input: z.infer<typeof reviewShiftRequestInputSchema>,
) {
  return review(caller, input, "approved");
}

export function denyShiftRequestTool(
  caller: McpCaller,
  input: z.infer<typeof reviewShiftRequestInputSchema>,
) {
  return review(caller, input, "denied");
}
