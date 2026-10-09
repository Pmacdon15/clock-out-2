import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { TimeEntry } from "@/lib/types";

/**
 * A promise that React's `use()` can read synchronously, so components that
 * unwrap promises render on the first pass without needing Suspense.
 */
export function resolved<T>(value: T): Promise<T> {
  const promise = Promise.resolve(value) as Promise<T> & {
    status: "fulfilled";
    value: T;
  };
  promise.status = "fulfilled";
  promise.value = value;
  return promise;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

export function renderWithClient(ui: ReactElement) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

let nextId = 1;

export function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  const clockIn = new Date("2026-01-05T09:00:00Z");
  return {
    id: nextId++,
    user_id: "user_1",
    org_id: "org_1",
    clock_in: clockIn,
    clock_out: new Date("2026-01-05T17:00:00Z"),
    created_at: clockIn,
    updated_at: clockIn,
    ...overrides,
  };
}
