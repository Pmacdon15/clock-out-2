/**
 * Clerk's list endpoints are paginated: they return at most `limit` items per
 * call (the default is only 10) plus the `totalCount` that exists remotely.
 * Asking for a single page silently drops everyone past it, so every place that
 * needs *all* orgs/members/invitations walks the pages through `fetchAllPages`.
 */

/** Largest `limit` Clerk accepts (`ClerkPaginationRequest` requires < 501). */
export const CLERK_MAX_PAGE_SIZE = 500;

/** Page size we ask for: a good citizen's compromise on request count. */
export const CLERK_PAGE_SIZE = 100;

/** Stop after this many pages so a misbehaving API cannot spin forever. */
export const CLERK_MAX_PAGES = 200;

/** The `{ data, totalCount }` shape every paginated Clerk response has. */
export type ClerkPage<T> = { data: T[]; totalCount?: number };

/** What `fetchAllPages` passes to the Clerk list call for each page. */
export type ClerkPageParams = { limit: number; offset: number };

export type FetchAllPagesOptions = {
  /** Items per request, clamped to 1..`CLERK_MAX_PAGE_SIZE`. */
  pageSize?: number;
  /** Page ceiling, clamped to at least 1. Defaults to `CLERK_MAX_PAGES`. */
  maxPages?: number;
  /** Name used in the log line when the page ceiling is hit. */
  label?: string;
};

/**
 * Calls `fetchPage` with `limit`/`offset` until every remote item has been
 * collected, and returns them in page order.
 *
 * Termination is deliberately defensive: an empty or short page ends the walk
 * even if `totalCount` claims there is more, a `totalCount` that is missing or
 * not a finite number is ignored rather than trusted, and `maxPages` caps the
 * walk so a bogus response can never loop forever. Rejections from `fetchPage`
 * propagate so callers keep handling Clerk failures the way they already do.
 */
export async function fetchAllPages<T>(
  fetchPage: (params: ClerkPageParams) => Promise<ClerkPage<T> | undefined>,
  options: FetchAllPagesOptions = {},
): Promise<T[]> {
  const limit = Math.min(
    Math.max(1, Math.floor(options.pageSize ?? CLERK_PAGE_SIZE)),
    CLERK_MAX_PAGE_SIZE,
  );
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? CLERK_MAX_PAGES));

  const items: T[] = [];

  for (let page = 0; page < maxPages; page++) {
    const response = await fetchPage({ limit, offset: items.length });
    const batch = response?.data ?? [];
    items.push(...batch);

    // Nothing more to read: Clerk gave us a partial (or empty) page.
    if (batch.length < limit) return items;

    const totalCount = response?.totalCount;
    if (Number.isFinite(totalCount) && items.length >= (totalCount as number)) {
      return items;
    }
  }

  console.warn(
    `[Clerk] Stopped paginating ${options.label ?? "list"} after ${maxPages} pages (${items.length} items).`,
  );
  return items;
}
