"use server";

import { refresh } from "next/cache";
import type { NewAvailabilityInput } from "./availability";
import { addAvailabilityDal, deleteAvailabilityDal } from "./availability-dal";

type ActionResult = { success: true } | { success: false; error: string };

function respond(result: { ok: true } | { ok: false; reason: string }) {
  if (!result.ok) return { success: false, error: result.reason } as const;
  // Re-render the Schedule page so the list and warnings show the change.
  refresh();
  return { success: true } as const;
}

export async function addAvailabilityAction(
  input: NewAvailabilityInput,
): Promise<ActionResult> {
  return respond(await addAvailabilityDal(input));
}

export async function deleteAvailabilityAction(
  id: number,
): Promise<ActionResult> {
  return respond(await deleteAvailabilityDal(id));
}
