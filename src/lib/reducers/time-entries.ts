import type { TimeEntry } from "@/lib/types";

export type EntryAction =
  | { type: "ADD"; payload: TimeEntry }
  | { type: "REMOVE"; payload: TimeEntry["id"] }
  | { type: "UPDATE"; payload: Partial<TimeEntry> & { id: TimeEntry["id"] } };

export function timeEntriesReducer(
  state: TimeEntry[],
  action: EntryAction,
): TimeEntry[] {
  switch (action.type) {
    case "ADD":
      return [action.payload, ...state];

    case "REMOVE":
      return state.filter(
        (entry) => String(entry.id) !== String(action.payload),
      );

    case "UPDATE":
      return state.map((entry) =>
        String(entry.id) === String(action.payload.id)
          ? { ...entry, ...action.payload }
          : entry,
      );

    default:
      return state;
  }
}
