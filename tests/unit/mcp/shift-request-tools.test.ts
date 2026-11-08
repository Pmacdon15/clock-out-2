import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledShift, ShiftRequest } from "@/lib/types";

/*
 * End-to-end tests for the shift swap and pickup tools: a real MCP server
 * (the same registerClockOutTools the /api/mcp route uses) on an in-memory
 * transport, driven with JSON-RPC like an AI client would, over an
 * in-memory stand-in for the database. The shared rules in
 * src/lib/shift-requests.ts run for real.
 */

type Store = {
  shifts: Map<number, ScheduledShift>;
  requests: Map<number, ShiftRequest>;
  nextRequestId: number;
};

const m = vi.hoisted(() => {
  const store: Store = {
    shifts: new Map(),
    requests: new Map(),
    nextRequestId: 1,
  };
  return {
    store,
    hasScheduling: { value: true },
    notifyShiftRequest: vi.fn(async () => 1),
    mirrorReassignedShifts: vi.fn(async () => undefined),
    revalidateTag: vi.fn(),
  };
});

/* --------------------------------------------------- people & orgs -- */

const ORGS = {
  org_a: { id: "org_a", name: "Acme Cafe", slug: "acme" },
  org_b: { id: "org_b", name: "Bistro", slug: "bistro" },
} as const;

const PEOPLE = [
  {
    userId: "mgr",
    first: "Morgan",
    last: "Manager",
    org: "org_a",
    admin: true,
  },
  { userId: "amy", first: "Amy", last: "Adams", org: "org_a", admin: false },
  { userId: "ben", first: "Ben", last: "Brown", org: "org_a", admin: false },
  { userId: "cat", first: "Cat", last: "Cole", org: "org_a", admin: false },
  { userId: "zed", first: "Zed", last: "Zane", org: "org_b", admin: false },
  { userId: "boss", first: "Bo", last: "Boss", org: "org_b", admin: true },
] as const;

const membership = (p: (typeof PEOPLE)[number]) => ({
  role: p.admin ? "org:admin" : "org:member",
  organization: {
    id: ORGS[p.org].id,
    name: ORGS[p.org].name,
    slug: ORGS[p.org].slug,
    membersCount: 4,
    hasImage: false,
    imageUrl: "",
  },
  publicUserData: {
    userId: p.userId,
    firstName: p.first,
    lastName: p.last,
    identifier: `${p.userId}@example.com`,
  },
});

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    users: {
      getOrganizationMembershipList: async ({ userId }: { userId: string }) => {
        const data = PEOPLE.filter((p) => p.userId === userId).map(membership);
        return { data, totalCount: data.length };
      },
    },
    organizations: {
      getOrganizationMembershipList: async ({
        organizationId,
      }: {
        organizationId: string;
      }) => {
        const data = PEOPLE.filter((p) => p.org === organizationId).map(
          membership,
        );
        return { data, totalCount: data.length };
      },
    },
  })),
}));

/* ------------------------------------------------- in-memory database -- */

const ACTIVE = ["open", "pending_approval"];

function detail(r: ShiftRequest) {
  const s = m.store.shifts.get(r.shift_id) as ScheduledShift;
  const w = r.swap_shift_id ? m.store.shifts.get(r.swap_shift_id) : undefined;
  return {
    ...r,
    shift_start: s.shift_start,
    shift_end: s.shift_end,
    shift_owner: s.user_id,
    shift_note: s.note,
    swap_shift_start: w?.shift_start ?? null,
    swap_shift_end: w?.shift_end ?? null,
    swap_shift_owner: w?.user_id ?? null,
  };
}

const shiftsIn = (orgId: string) =>
  [...m.store.shifts.values()].filter((s) => s.org_id === orgId);

vi.mock("@/lib/db", () => ({
  dbGetScheduledShiftById: async (id: number, orgId: string) => {
    const s = m.store.shifts.get(id);
    return s && s.org_id === orgId ? { ...s } : undefined;
  },
  dbGetScheduledShifts: async (
    orgId: string,
    userId: string | null,
    start: Date,
    end: Date,
  ) =>
    shiftsIn(orgId).filter(
      (s) =>
        (userId === null || s.user_id === userId) &&
        s.shift_start >= start &&
        s.shift_start < end,
    ),
  dbGetApprovedTimeOffForPeriod: async () => [],
}));

vi.mock("@/lib/shift-requests-db", () => ({
  ACTIVE_SHIFT_REQUEST_STATUSES: ["open", "pending_approval"],
  dbListShiftRequests: async (orgId: string, statuses: string[], since: Date) =>
    [...m.store.requests.values()]
      .filter((r) => r.org_id === orgId && statuses.includes(r.status))
      .map(detail)
      .filter((d) => new Date(d.shift_end) > since),
  dbGetShiftRequest: async (id: number, orgId: string) => {
    const r = m.store.requests.get(id);
    return r && r.org_id === orgId ? detail(r) : undefined;
  },
  dbCreateShiftRequest: async (input: {
    orgId: string;
    type: ShiftRequest["request_type"];
    shiftId: number;
    swapShiftId: number | null;
    requestedBy: string;
    targetUserId: string | null;
    claimedBy: string | null;
    note: string | null;
  }) => {
    const ids = [input.shiftId, input.swapShiftId];
    const busy = [...m.store.requests.values()].some(
      (r) =>
        r.org_id === input.orgId &&
        ACTIVE.includes(r.status) &&
        (ids.includes(r.shift_id) || ids.includes(r.swap_shift_id)),
    );
    if (busy) return undefined;
    const request: ShiftRequest = {
      id: m.store.nextRequestId++,
      org_id: input.orgId,
      request_type: input.type,
      shift_id: input.shiftId,
      swap_shift_id: input.swapShiftId,
      requested_by: input.requestedBy,
      target_user_id: input.targetUserId,
      claimed_by: input.claimedBy,
      note: input.note,
      status: "open",
      claimed_at: null,
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
      cancelled_by: null,
    };
    m.store.requests.set(request.id, request);
    return { ...request };
  },
  dbClaimShiftRequest: async (
    id: number,
    orgId: string,
    claimedBy: string | null,
  ) => {
    const r = m.store.requests.get(id);
    if (!r || r.org_id !== orgId || r.status !== "open") return undefined;
    r.claimed_by = claimedBy ?? r.claimed_by;
    r.status = "pending_approval";
    r.claimed_at = new Date();
    return { ...r };
  },
  dbCancelShiftRequest: async (id: number, orgId: string, by: string) => {
    const r = m.store.requests.get(id);
    if (!r || r.org_id !== orgId || !ACTIVE.includes(r.status)) {
      return undefined;
    }
    r.status = "cancelled";
    r.cancelled_by = by;
    return { ...r };
  },
  dbDenyShiftRequest: async (
    id: number,
    orgId: string,
    by: string,
    note: string | null,
  ) => {
    const r = m.store.requests.get(id);
    if (!r || r.org_id !== orgId || r.status !== "pending_approval") {
      return undefined;
    }
    Object.assign(r, {
      status: "denied",
      reviewed_by: by,
      reviewed_at: new Date(),
      review_note: note,
    });
    return { ...r };
  },
  // Same guards as the SQL: still pending, and each shift still belongs
  // to the member giving it up.
  dbApproveShiftRequest: async (
    id: number,
    orgId: string,
    by: string,
    note: string | null,
  ) => {
    const r = m.store.requests.get(id);
    if (!r || r.org_id !== orgId || r.status !== "pending_approval") {
      return undefined;
    }
    const giver =
      r.request_type === "pickup" ? r.target_user_id : r.requested_by;
    const shift = m.store.shifts.get(r.shift_id);
    const swap = r.swap_shift_id ? m.store.shifts.get(r.swap_shift_id) : null;
    if (shift?.user_id !== giver) return undefined;
    if (r.swap_shift_id && swap?.user_id !== r.claimed_by) return undefined;
    Object.assign(r, {
      status: "approved",
      reviewed_by: by,
      reviewed_at: new Date(),
      review_note: note,
    });
    shift.user_id = r.claimed_by as string;
    if (swap) swap.user_id = r.requested_by;
    const moved = [shift, ...(swap ? [swap] : [])];
    const superseded = [...m.store.requests.values()].filter(
      (o) =>
        o.id !== r.id &&
        o.org_id === orgId &&
        ACTIVE.includes(o.status) &&
        moved.some((s) => s.id === o.shift_id || s.id === o.swap_shift_id),
    );
    for (const o of superseded) o.status = "cancelled";
    return {
      request: { ...r },
      shifts: moved.map((s) => ({ ...s })),
      superseded,
    };
  },
  dbGetOverlappingScheduledShifts: async (
    orgId: string,
    userId: string,
    start: Date,
    end: Date,
    exclude: number[],
  ) =>
    shiftsIn(orgId).filter(
      (s) =>
        s.user_id === userId &&
        s.shift_start < end &&
        s.shift_end > start &&
        !exclude.includes(s.id),
    ),
}));

vi.mock("@/lib/plan-features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plan-features")>()),
  orgHasPlanFeature: async () => m.hasScheduling.value,
}));
vi.mock("@/lib/shift-request-notify", () => ({
  notifyShiftRequest: m.notifyShiftRequest,
  mirrorReassignedShifts: m.mirrorReassignedShifts,
}));
vi.mock("next/cache", () => ({
  revalidateTag: m.revalidateTag,
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}));

// Other tools' dependencies; none of them run here.
vi.mock("@/mcp/db", () => ({}));
vi.mock("@/lib/alerts-db", () => ({}));
vi.mock("@/lib/schedule-notify", () => ({}));
vi.mock("@/lib/notify", () => ({}));
vi.mock("@/lib/reports", () => ({}));
vi.mock("@/lib/utils-clerk", () => ({}));
vi.mock("@/lib/geoapify", () => ({}));

import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { MCP_INSTRUCTIONS } from "@/mcp/instructions";
import {
  registerClockOutTools,
  SERVER_INFO,
  SERVER_OPTIONS,
} from "@/mcp/server";

/* ---------------------------------------------------- the MCP client -- */

type RpcResponse = {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

type CallResult = {
  content: { type: string; text: string }[];
  structuredContent: Record<string, unknown> & { status?: string };
  isError?: boolean;
};

async function connect() {
  const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);
  registerClockOutTools(server);
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (r: RpcResponse) => void>();
  client.onmessage = (message) => {
    const msg = message as unknown as RpcResponse;
    if (typeof msg.id === "number") pending.get(msg.id)?.(msg);
  };
  await server.connect(serverSide);
  await client.start();
  let nextId = 1;

  const request = (
    method: string,
    params: Record<string, unknown>,
    userId?: string,
  ) => {
    const id = nextId++;
    const done = new Promise<RpcResponse>((resolve) =>
      pending.set(id, resolve),
    );
    void client.send(
      { jsonrpc: "2.0", id, method, params } as never,
      userId
        ? {
            authInfo: {
              token: `token-${userId}`,
              clientId: "test-client",
              scopes: [],
              extra: { userId },
            },
          }
        : undefined,
    );
    return done;
  };

  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  });
  expect(init.error).toBeUndefined();
  await client.send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  } as never);

  return {
    request,
    async call(
      userId: string | undefined,
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<CallResult> {
      const res = await request(
        "tools/call",
        { name, arguments: { timezone: "UTC", ...args } },
        userId,
      );
      expect(res.error, `${name}: ${res.error?.message}`).toBeUndefined();
      return res.result as unknown as CallResult;
    },
    close: () => client.close(),
  };
}

type Client = Awaited<ReturnType<typeof connect>>;

/* -------------------------------------------------------- fixtures -- */

const at = (iso: string) => new Date(`${iso}Z`);

function shift(
  id: number,
  userId: string,
  start: string,
  end: string,
  orgId = "org_a",
): ScheduledShift {
  return {
    id,
    org_id: orgId,
    user_id: userId,
    shift_start: at(start),
    shift_end: at(end),
    note: null,
    created_by: "mgr",
  };
}

function seed() {
  m.store.shifts.clear();
  m.store.requests.clear();
  m.store.nextRequestId = 1;
  for (const s of [
    // Amy's Saturday shift.
    shift(1, "amy", "2099-03-07T09:00:00", "2099-03-07T17:00:00"),
    shift(2, "ben", "2099-03-08T09:00:00", "2099-03-08T17:00:00"),
    // Overlaps Amy's Saturday, so Cat can't take it.
    shift(3, "cat", "2099-03-07T12:00:00", "2099-03-07T20:00:00"),
    shift(4, "ben", "2099-03-09T09:00:00", "2099-03-09T17:00:00"),
    // Already over.
    shift(5, "amy", "2020-01-01T09:00:00", "2020-01-01T17:00:00"),
    shift(900, "zed", "2099-03-07T09:00:00", "2099-03-07T17:00:00", "org_b"),
  ]) {
    m.store.shifts.set(s.id, s);
  }
}

const ownerOf = (id: number) => m.store.shifts.get(id)?.user_id;
const requestId = (r: CallResult) =>
  (r.structuredContent.request as { request_id: number }).request_id;

let mcp: Client;

beforeEach(async () => {
  seed();
  m.hasScheduling.value = true;
  mcp?.close();
  mcp = await connect();
});

/* ---------------------------------------------------------- tests -- */

const SHIFT_TOOLS = [
  "post_shift_for_pickup",
  "request_shift_swap",
  "request_shift_pickup",
  "list_open_shifts",
  "claim_shift",
  "cancel_shift_request",
  "list_pending_shift_requests",
  "approve_shift_request",
  "deny_shift_request",
];

describe("tools/list", () => {
  it("lists every shift request tool with a schema, description and hints", async () => {
    const res = await mcp.request("tools/list", {}, "amy");
    const tools = (
      res.result as {
        tools: {
          name: string;
          description: string;
          inputSchema: { type: string; properties: Record<string, unknown> };
          annotations: Record<string, boolean>;
        }[];
      }
    ).tools;
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of SHIFT_TOOLS) {
      const tool = byName.get(name);
      expect(tool, name).toBeDefined();
      expect(tool?.description.length, name).toBeGreaterThan(60);
      expect(tool?.inputSchema.type, name).toBe("object");
      expect(tool?.inputSchema.properties.org_id, name).toBeDefined();
      expect(tool?.annotations.openWorldHint, name).toBe(false);
    }
    expect(byName.get("list_open_shifts")?.annotations.readOnlyHint).toBe(true);
    expect(
      byName.get("list_pending_shift_requests")?.annotations.readOnlyHint,
    ).toBe(true);
    expect(byName.get("approve_shift_request")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(
      byName.get("claim_shift")?.inputSchema.properties.request_id,
    ).toBeDefined();
    expect(
      byName.get("request_shift_swap")?.inputSchema.properties.their_shift_id,
    ).toBeDefined();
  });

  it("tells the AI when to use each tool", () => {
    for (const name of SHIFT_TOOLS) {
      expect(MCP_INSTRUCTIONS, name).toContain(name);
    }
    expect(MCP_INSTRUCTIONS).toMatch(/Regular members can never approve/);
  });
});

describe("offer: post → list → claim → approve", () => {
  it("reassigns the shift to the coworker who claimed it", async () => {
    const posted = await mcp.call("amy", "post_shift_for_pickup", {
      date: "2099-03-07",
      note: "Family thing",
    });
    expect(posted.isError).toBeUndefined();
    expect(posted.structuredContent.status).toBe("open");
    expect(posted.content[0].text).toMatch(/Posted your shift/);
    const id = requestId(posted);
    expect(m.notifyShiftRequest).toHaveBeenCalledWith(
      "created",
      expect.objectContaining({ id, request_type: "offer" }),
      expect.anything(),
      "amy",
      "UTC",
    );

    const forBen = await mcp.call("ben", "list_open_shifts");
    const available = forBen.structuredContent.available_to_claim as {
      request_id: number;
      shift: { owner: string };
    }[];
    expect(available.map((r) => r.request_id)).toEqual([id]);
    expect(available[0].shift.owner).toBe("Amy Adams");

    const forAmy = await mcp.call("amy", "list_open_shifts");
    expect(forAmy.structuredContent.available_to_claim).toEqual([]);
    expect(
      (forAmy.structuredContent.your_requests as { status: string }[])[0]
        .status,
    ).toBe("open");

    const claimed = await mcp.call("ben", "claim_shift", { request_id: id });
    expect(claimed.isError).toBeUndefined();
    expect(claimed.structuredContent.status).toBe("pending_approval");
    // Claiming alone doesn't touch the schedule.
    expect(ownerOf(1)).toBe("amy");

    const pending = await mcp.call("mgr", "list_pending_shift_requests");
    const listed = pending.structuredContent.requests as {
      request_id: number;
      taking_shift: string;
    }[];
    expect(listed).toEqual([
      expect.objectContaining({ request_id: id, taking_shift: "Ben Brown" }),
    ]);

    const approved = await mcp.call("mgr", "approve_shift_request", {
      request_id: id,
      note: "Thanks Ben",
    });
    expect(approved.isError).toBeUndefined();
    expect(approved.structuredContent.status).toBe("approved");
    expect(approved.content[0].text).toMatch(
      /moved from Amy Adams to Ben Brown/,
    );
    expect(ownerOf(1)).toBe("ben");
    expect(m.store.requests.get(id)).toMatchObject({
      status: "approved",
      reviewed_by: "mgr",
      review_note: "Thanks Ben",
    });
    expect(m.revalidateTag).toHaveBeenCalledWith("scheduled-shifts-org_a", {
      expire: 0,
    });
    expect(m.mirrorReassignedShifts).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 1, user_id: "amy" })],
      [expect.objectContaining({ id: 1, user_id: "ben" })],
    );
    expect(m.notifyShiftRequest).toHaveBeenCalledWith(
      "approved",
      expect.objectContaining({ id }),
      expect.anything(),
      "mgr",
      "UTC",
    );

    // A closed request can't be acted on again.
    for (const [user, tool, status] of [
      ["cat", "claim_shift", "not_open"],
      ["amy", "cancel_shift_request", "not_open"],
      ["mgr", "approve_shift_request", "not_pending"],
      ["mgr", "deny_shift_request", "not_pending"],
    ] as const) {
      const res = await mcp.call(user, tool, { request_id: id });
      expect(res.isError, tool).toBe(true);
      expect(res.structuredContent.status, tool).toBe(status);
    }
    expect(ownerOf(1)).toBe("ben");
  });
});

describe("swap", () => {
  it("trades both shifts once the coworker accepts and a manager approves", async () => {
    const asked = await mcp.call("amy", "request_shift_swap", {
      shift_id: 1,
      coworker: "Ben",
      their_date: "2099-03-08",
    });
    expect(asked.isError).toBeUndefined();
    expect(asked.content[0].text).toMatch(/Asked Ben Brown to swap/);
    const id = requestId(asked);

    // Only Ben can accept it.
    const cat = await mcp.call("cat", "claim_shift", { request_id: id });
    expect(cat.structuredContent.status).toBe("forbidden");

    const forBen = await mcp.call("ben", "list_open_shifts");
    expect(
      (forBen.structuredContent.awaiting_your_answer as unknown[]).length,
    ).toBe(1);

    const accepted = await mcp.call("ben", "claim_shift", { request_id: id });
    expect(accepted.content[0].text).toMatch(/^Accepted/);

    const approved = await mcp.call("mgr", "approve_shift_request", {
      request_id: id,
    });
    expect(approved.isError).toBeUndefined();
    expect(ownerOf(1)).toBe("ben");
    expect(ownerOf(2)).toBe("amy");
    expect(
      (approved.structuredContent.reassigned_shifts as unknown[]).length,
    ).toBe(2);
  });

  it("lets the coworker decline, leaving the schedule alone", async () => {
    const asked = await mcp.call("amy", "request_shift_swap", {
      shift_id: 1,
      coworker: "ben@example.com",
      their_shift_id: 2,
    });
    const declined = await mcp.call("ben", "cancel_shift_request", {
      request_id: requestId(asked),
    });
    expect(declined.structuredContent.status).toBe("cancelled");
    expect(declined.content[0].text).toMatch(/^Declined/);
    expect(ownerOf(1)).toBe("amy");
    expect(ownerOf(2)).toBe("ben");
  });
});

describe("pickup and deny", () => {
  it("keeps the schedule when a manager denies the request", async () => {
    const asked = await mcp.call("ben", "request_shift_pickup", {
      coworker: "Amy Adams",
      date: "2099-03-07",
    });
    expect(asked.isError).toBeUndefined();
    const id = requestId(asked);
    expect(
      (await mcp.call("amy", "claim_shift", { request_id: id }))
        .structuredContent.status,
    ).toBe("pending_approval");

    const denied = await mcp.call("mgr", "deny_shift_request", {
      request_id: id,
      note: "Ben is at his hours limit",
    });
    expect(denied.structuredContent.status).toBe("denied");
    expect(ownerOf(1)).toBe("amy");
    expect(m.store.requests.get(id)?.review_note).toBe(
      "Ben is at his hours limit",
    );
  });
});

describe("cancel", () => {
  it("lets only the requester (or an admin) withdraw an offer", async () => {
    const id = requestId(
      await mcp.call("amy", "post_shift_for_pickup", { shift_id: 1 }),
    );
    expect(
      (await mcp.call("ben", "cancel_shift_request", { request_id: id }))
        .structuredContent.status,
    ).toBe("forbidden");
    const cancelled = await mcp.call("amy", "cancel_shift_request", {
      request_id: id,
    });
    expect(cancelled.content[0].text).toMatch(/^Cancelled/);
    expect(
      (await mcp.call("ben", "claim_shift", { request_id: id }))
        .structuredContent.status,
    ).toBe("not_open");
  });

  it("lets an admin cancel a pending request", async () => {
    const id = requestId(
      await mcp.call("amy", "post_shift_for_pickup", { shift_id: 1 }),
    );
    await mcp.call("ben", "claim_shift", { request_id: id });
    const res = await mcp.call("mgr", "cancel_shift_request", {
      request_id: id,
    });
    expect(res.structuredContent.status).toBe("cancelled");
    expect(ownerOf(1)).toBe("amy");
  });
});

describe("permissions", () => {
  it("never lets an employee approve, deny or see the approval queue", async () => {
    const id = requestId(
      await mcp.call("amy", "post_shift_for_pickup", { shift_id: 1 }),
    );
    await mcp.call("ben", "claim_shift", { request_id: id });
    for (const tool of ["approve_shift_request", "deny_shift_request"]) {
      for (const user of ["amy", "ben"]) {
        const res = await mcp.call(user, tool, { request_id: id });
        expect(res.isError, `${user} ${tool}`).toBe(true);
        expect(res.structuredContent.status).toBe("forbidden");
      }
    }
    const queue = await mcp.call("ben", "list_pending_shift_requests");
    expect(queue.structuredContent.status).toBe("forbidden");
    expect(ownerOf(1)).toBe("amy");
    expect(m.store.requests.get(id)?.status).toBe("pending_approval");
  });

  it("rejects claiming your own shift", async () => {
    const id = requestId(
      await mcp.call("amy", "post_shift_for_pickup", { shift_id: 1 }),
    );
    const res = await mcp.call("amy", "claim_shift", { request_id: id });
    expect(res.structuredContent.status).toBe("own_shift");
    expect(
      (
        await mcp.call("ben", "request_shift_pickup", {
          coworker: "Ben Brown",
          shift_id: 2,
        })
      ).structuredContent.status,
    ).toBe("own_shift");
  });

  it("keeps other organizations out", async () => {
    const id = requestId(
      await mcp.call("amy", "post_shift_for_pickup", { shift_id: 1 }),
    );
    // Zed is in another org: the request and shifts don't exist for him.
    for (const tool of ["claim_shift", "cancel_shift_request"]) {
      const res = await mcp.call("zed", tool, { request_id: id });
      expect(res.structuredContent.status, tool).toBe("not_found");
    }
    // Being an admin elsewhere grants nothing here.
    await mcp.call("ben", "claim_shift", { request_id: id });
    for (const tool of [
      "approve_shift_request",
      "deny_shift_request",
      "cancel_shift_request",
    ]) {
      const res = await mcp.call("boss", tool, { request_id: id });
      expect(res.structuredContent.status, tool).toBe("not_found");
    }
    expect(
      (await mcp.call("boss", "list_pending_shift_requests")).structuredContent
        .requests,
    ).toEqual([]);
    expect(ownerOf(1)).toBe("amy");
    expect(
      (await mcp.call("zed", "post_shift_for_pickup", { shift_id: 1 }))
        .structuredContent.status,
    ).toBe("not_found");
    expect(
      (await mcp.call("amy", "post_shift_for_pickup", { shift_id: 900 }))
        .structuredContent.status,
    ).toBe("not_found");
    expect(
      (
        await mcp.call("amy", "post_shift_for_pickup", {
          shift_id: 1,
          org_id: "org_b",
        })
      ).structuredContent.status,
    ).toBe("organization_not_found");
    // Nor can they be named as the coworker.
    expect(
      (
        await mcp.call("amy", "request_shift_pickup", {
          coworker: "Zed",
          shift_id: 900,
        })
      ).structuredContent.status,
    ).toBe("member_not_found");
    expect(
      (await mcp.call("zed", "list_open_shifts")).structuredContent,
    ).toMatchObject({ available_to_claim: [], your_requests: [] });
    expect(m.store.requests.get(id)?.status).toBe("pending_approval");
  });

  it("only lets the named coworker claim a targeted offer", async () => {
    const id = requestId(
      await mcp.call("amy", "post_shift_for_pickup", {
        shift_id: 1,
        offer_to: "Ben",
      }),
    );
    const forCat = await mcp.call("cat", "list_open_shifts");
    expect(forCat.structuredContent.available_to_claim).toEqual([]);
    expect(
      (await mcp.call("cat", "claim_shift", { request_id: id }))
        .structuredContent.status,
    ).toBe("forbidden");
    expect(
      (await mcp.call("ben", "claim_shift", { request_id: id }))
        .structuredContent.status,
    ).toBe("pending_approval");
  });

  it("only lets members offer their own shifts", async () => {
    const res = await mcp.call("amy", "post_shift_for_pickup", {
      shift_id: 2,
    });
    expect(res.structuredContent.status).toBe("forbidden");
  });

  it("refuses callers who aren't signed in", async () => {
    const res = await mcp.call(undefined, "list_open_shifts");
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Not signed in/);
  });
});

describe("guards", () => {
  it("won't double-book the coworker", async () => {
    const id = requestId(
      await mcp.call("amy", "post_shift_for_pickup", { shift_id: 1 }),
    );
    const res = await mcp.call("cat", "claim_shift", { request_id: id });
    expect(res.structuredContent.status).toBe("schedule_conflict");
  });

  it("won't trade a shift that already started", async () => {
    const res = await mcp.call("amy", "post_shift_for_pickup", {
      shift_id: 5,
    });
    expect(res.structuredContent.status).toBe("shift_started");
  });

  it("keeps a shift in one live request at a time", async () => {
    await mcp.call("amy", "post_shift_for_pickup", { shift_id: 1 });
    const again = await mcp.call("amy", "post_shift_for_pickup", {
      shift_id: 1,
    });
    expect(again.structuredContent.status).toBe("already_requested");
  });

  it("asks which shift when the day is ambiguous or empty", async () => {
    const none = await mcp.call("amy", "post_shift_for_pickup", {
      date: "2099-03-10",
    });
    expect(none.structuredContent.status).toBe("invalid_input");
    expect(none.content[0].text).toMatch(/no shift on 2099-03-10/);
    const missing = await mcp.call("amy", "post_shift_for_pickup", {});
    expect(missing.content[0].text).toMatch(/Pass shift_id, or date/);
  });

  it("refuses approval when the shift changed hands meanwhile", async () => {
    const id = requestId(
      await mcp.call("amy", "post_shift_for_pickup", { shift_id: 1 }),
    );
    await mcp.call("ben", "claim_shift", { request_id: id });
    // Moved to someone else in the meantime (e.g. another approved request).
    (m.store.shifts.get(1) as ScheduledShift).user_id = "mgr";
    const res = await mcp.call("mgr", "approve_shift_request", {
      request_id: id,
    });
    expect(res.structuredContent.status).toBe("shift_changed");
    expect(ownerOf(1)).toBe("mgr");
  });

  it("needs the Scheduling plan feature", async () => {
    m.hasScheduling.value = false;
    const res = await mcp.call("amy", "list_open_shifts");
    expect(res.structuredContent.status).toBe("scheduling_not_enabled");
  });

  it("rejects input that doesn't match the schema", async () => {
    const res = await mcp.request(
      "tools/call",
      { name: "claim_shift", arguments: { request_id: "seven" } },
      "amy",
    );
    const result = res.result as CallResult | undefined;
    // Either a JSON-RPC error or a tool error, never a claim.
    expect(Boolean(res.error) || result?.isError).toBe(true);
    expect(m.store.requests.size).toBe(0);
  });
});
