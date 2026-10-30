import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLERK_MAX_PAGE_SIZE,
  CLERK_MAX_PAGES,
  CLERK_PAGE_SIZE,
  fetchAllPages,
} from "@/lib/clerk-pagination";

/** A fake Clerk list endpoint over `items`, honouring limit/offset. */
function pagedEndpoint<T>(items: T[], totalCount: number = items.length) {
  return vi.fn(
    async ({ limit, offset }: { limit: number; offset: number }) => ({
      data: items.slice(offset, offset + limit),
      totalCount,
    }),
  );
}

/** The `{ limit, offset }` of every call made, in order. */
const callsOf = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.map(([params]) => params);

const ids = (count: number, prefix = "id") =>
  Array.from({ length: count }, (_, i) => `${prefix}_${i + 1}`);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("fetchAllPages", () => {
  it("makes a single request when everything fits in one page", async () => {
    const endpoint = pagedEndpoint(ids(3));

    await expect(fetchAllPages(endpoint, { pageSize: 10 })).resolves.toEqual(
      ids(3),
    );
    expect(endpoint).toHaveBeenCalledTimes(1);
    expect(callsOf(endpoint)).toEqual([{ limit: 10, offset: 0 }]);
  });

  it("returns an empty list for an empty result", async () => {
    const endpoint = pagedEndpoint([]);

    await expect(fetchAllPages(endpoint)).resolves.toEqual([]);
    expect(endpoint).toHaveBeenCalledTimes(1);
    expect(callsOf(endpoint)).toEqual([{ limit: CLERK_PAGE_SIZE, offset: 0 }]);
  });

  it("walks every page until totalCount is consumed", async () => {
    const endpoint = pagedEndpoint(ids(5));

    await expect(fetchAllPages(endpoint, { pageSize: 2 })).resolves.toEqual(
      ids(5),
    );
    expect(endpoint).toHaveBeenCalledTimes(3);
    expect(callsOf(endpoint)).toEqual([
      { limit: 2, offset: 0 },
      { limit: 2, offset: 2 },
      { limit: 2, offset: 4 },
    ]);
  });

  it("stops on totalCount without asking for an extra empty page", async () => {
    const endpoint = pagedEndpoint(ids(4));

    await expect(fetchAllPages(endpoint, { pageSize: 2 })).resolves.toEqual(
      ids(4),
    );
    expect(endpoint).toHaveBeenCalledTimes(2);
  });

  it("keeps paginating when totalCount is missing", async () => {
    const items = ids(5);
    const endpoint = vi.fn(
      async ({ limit, offset }: { limit: number; offset: number }) => ({
        data: items.slice(offset, offset + limit),
      }),
    );

    await expect(fetchAllPages(endpoint, { pageSize: 2 })).resolves.toEqual(
      items,
    );
    expect(endpoint).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["an empty page", 0],
    ["a short page", 1],
  ])("stops on %s even when totalCount claims more", async (_label, tail) => {
    // totalCount lies: it promises 100 items but the data runs out at 2 + tail.
    const endpoint = pagedEndpoint(ids(2 + tail), 100);

    await expect(fetchAllPages(endpoint, { pageSize: 2 })).resolves.toEqual(
      ids(2 + tail),
    );
    expect(endpoint).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["not a number", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("ignores a totalCount that is %s", async (_label, totalCount) => {
    const endpoint = pagedEndpoint(ids(3), totalCount);

    await expect(fetchAllPages(endpoint, { pageSize: 2 })).resolves.toEqual(
      ids(3),
    );
    expect(endpoint).toHaveBeenCalledTimes(2);
  });

  it("stops after a full page when totalCount is nonsensically low", async () => {
    const endpoint = pagedEndpoint(ids(6), -1);

    await expect(fetchAllPages(endpoint, { pageSize: 2 })).resolves.toEqual(
      ids(2),
    );
    expect(endpoint).toHaveBeenCalledTimes(1);
  });

  it("gives up at maxPages instead of looping forever", async () => {
    // Always a full page and a totalCount that can never be reached.
    const endpoint = vi.fn(async ({ limit }: { limit: number }) => ({
      data: ids(limit),
      totalCount: Number.POSITIVE_INFINITY,
    }));

    await expect(
      fetchAllPages(endpoint, { pageSize: 2, maxPages: 4, label: "members" }),
    ).resolves.toHaveLength(8);
    expect(endpoint).toHaveBeenCalledTimes(4);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Stopped paginating members after 4 pages"),
    );
  });

  it("names the list generically in the warning when no label is given", async () => {
    const endpoint = vi.fn(async ({ limit }: { limit: number }) => ({
      data: ids(limit),
    }));

    await fetchAllPages(endpoint, { pageSize: 1, maxPages: 1 });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Stopped paginating list after 1 pages"),
    );
  });

  it.each([
    ["caps the page size at Clerk's maximum", 1000, CLERK_MAX_PAGE_SIZE],
    ["floors a fractional page size", 2.7, 2],
    ["asks for at least one item", 0, 1],
    ["asks for at least one item", -5, 1],
  ])("%s", async (_label, pageSize, expected) => {
    const endpoint = pagedEndpoint(ids(1));

    await fetchAllPages(endpoint, { pageSize });
    expect(callsOf(endpoint)).toEqual([{ limit: expected, offset: 0 }]);
  });

  it("walks at least one page when maxPages is nonsense", async () => {
    const endpoint = pagedEndpoint(ids(1));

    await expect(fetchAllPages(endpoint, { maxPages: 0 })).resolves.toEqual(
      ids(1),
    );
    expect(endpoint).toHaveBeenCalledTimes(1);
  });

  it("defaults to Clerk's page size and page ceiling", async () => {
    const endpoint = vi.fn(async ({ limit }: { limit: number }) => ({
      data: ids(limit),
    }));

    await expect(fetchAllPages(endpoint)).resolves.toHaveLength(
      CLERK_PAGE_SIZE * CLERK_MAX_PAGES,
    );
    expect(endpoint).toHaveBeenCalledTimes(CLERK_MAX_PAGES);
  });

  it("treats a response without data as the end of the list", async () => {
    const endpoint = vi.fn(async () => undefined);

    await expect(fetchAllPages(endpoint)).resolves.toEqual([]);
    expect(endpoint).toHaveBeenCalledTimes(1);
  });

  it("propagates a failure part way through the walk", async () => {
    const endpoint = vi
      .fn()
      .mockResolvedValueOnce({ data: ids(2), totalCount: 10 })
      .mockRejectedValueOnce(new Error("Clerk is down"));

    await expect(fetchAllPages(endpoint, { pageSize: 2 })).rejects.toThrow(
      "Clerk is down",
    );
    expect(endpoint).toHaveBeenCalledTimes(2);
  });
});
