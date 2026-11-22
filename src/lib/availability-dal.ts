import { auth } from "@clerk/nextjs/server";
import {
  invalidAvailabilityReason,
  MAX_AVAILABILITY_WINDOWS,
  type NewAvailabilityInput,
} from "./availability";
import {
  dbAddAvailability,
  dbDeleteAvailability,
  dbListAvailability,
} from "./availability-db";
import { SCHEDULING_FEATURE, SCHEDULING_UPGRADE_REASON } from "./plan-features";
import type { AvailabilityWindow, SerializableResult } from "./types";

/*
 * Weekly availability for the Schedule page. Members manage their own;
 * admins see everyone's (to be warned when scheduling) and can remove any.
 */

type Failure = { ok: false; reason: string };
type Change<T> = { ok: true; value: T } | Failure;

async function signedIn(): Promise<
  { ok: true; userId: string; orgId: string; isAdmin: boolean } | Failure
> {
  const { userId, orgId, orgRole, has } = await auth.protect();
  if (!userId || !orgId) return { ok: false, reason: "Unauthorized" };
  if (!has({ feature: SCHEDULING_FEATURE })) {
    return { ok: false, reason: SCHEDULING_UPGRADE_REASON };
  }
  return { ok: true, userId, orgId, isAdmin: orgRole === "org:admin" };
}

export type AvailabilityView = {
  /** Everyone's windows for an admin; only the member's own otherwise. */
  windows: AvailabilityWindow[];
  userId: string;
  isAdmin: boolean;
};

export async function getAvailabilityView(): Promise<
  SerializableResult<AvailabilityView, { reason: string }>
> {
  const me = await signedIn();
  if (!me.ok) return { ok: false, error: { reason: me.reason } };
  try {
    const windows = await dbListAvailability(
      me.orgId,
      me.isAdmin ? null : me.userId,
    );
    return {
      ok: true,
      value: { windows, userId: me.userId, isAdmin: me.isAdmin },
    };
  } catch (e) {
    console.error("Error fetching availability: ", e);
    return { ok: false, error: { reason: "Error fetching availability" } };
  }
}

/** Adds weekly windows for the signed-in member, one per chosen weekday. */
export async function addAvailabilityDal(
  input: NewAvailabilityInput,
): Promise<Change<AvailabilityWindow[]>> {
  const me = await signedIn();
  if (!me.ok) return me;
  const invalid = invalidAvailabilityReason(input);
  if (invalid) return { ok: false, reason: invalid };
  const weekdays = [...new Set(input.weekdays)].sort();
  try {
    const added = await dbAddAvailability({
      orgId: me.orgId,
      userId: me.userId,
      kind: input.kind,
      weekdays,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      timezone: input.timezone,
      note: input.note?.trim() || null,
      max: MAX_AVAILABILITY_WINDOWS,
    });
    if (!added) {
      return {
        ok: false,
        reason: `You can keep up to ${MAX_AVAILABILITY_WINDOWS} availability times. Remove some first.`,
      };
    }
    return { ok: true, value: added };
  } catch (e) {
    console.error("Error saving availability: ", e);
    return { ok: false, reason: "Failed to save availability" };
  }
}

/** Removes one of the member's windows (an admin can remove anyone's). */
export async function deleteAvailabilityDal(
  id: number,
): Promise<Change<AvailabilityWindow>> {
  const me = await signedIn();
  if (!me.ok) return me;
  if (!Number.isInteger(id)) return { ok: false, reason: "Not found" };
  try {
    const deleted = await dbDeleteAvailability(
      id,
      me.orgId,
      me.isAdmin ? null : me.userId,
    );
    if (!deleted) return { ok: false, reason: "Not found" };
    return { ok: true, value: deleted };
  } catch (e) {
    console.error("Error removing availability: ", e);
    return { ok: false, reason: "Failed to remove availability" };
  }
}
