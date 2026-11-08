"use server";

import { resetCalendarFeedPath } from "./dal";

export type ResetCalendarFeedResult =
  | { status: "ok"; path: string }
  | { status: "error"; error: string };

/**
 * Gives the signed-in member a new calendar feed URL and revokes every older
 * one, for when a feed link was shared or a device was lost.
 */
export async function resetCalendarFeedAction(): Promise<ResetCalendarFeedResult> {
  try {
    const path = await resetCalendarFeedPath();
    if (!path) {
      return { status: "error", error: "Calendar feeds aren't available." };
    }
    return { status: "ok", path };
  } catch (error) {
    console.error("Error resetting calendar feed link:", error);
    return {
      status: "error",
      error: "Couldn't reset the calendar link. Try again.",
    };
  }
}
