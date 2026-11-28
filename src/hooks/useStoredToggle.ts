"use client";

import { useCallback, useSyncExternalStore } from "react";

const CHANGE_EVENT = "stored-toggle-change";

/** Choices made while storage is blocked, kept until the page reloads. */
const memory = new Map<string, boolean>();

function read(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? (memory.get(key) ?? fallback) : value === "1";
  } catch {
    return memory.get(key) ?? fallback;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * An on/off choice remembered in this browser (a viewer convenience, not
 * shared). Falls back to `fallback` when storage is empty or blocked, and on
 * the server.
 */
export function useStoredToggle(
  key: string,
  fallback: boolean,
): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
  const set = useCallback(
    (next: boolean) => {
      memory.set(key, next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Storage blocked: the choice lasts until the page reloads.
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [key],
  );
  return [value, set];
}
