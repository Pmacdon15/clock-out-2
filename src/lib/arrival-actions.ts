"use server";

import { reportSiteArrivalDal } from "./arrival-dal";
import type { Coordinates } from "./geo";

/**
 * The member's device saw them walk into a work site. The server decides
 * whether that earns a "Clock in?" prompt; see `reportSiteArrivalDal`.
 */
export async function reportSiteArrivalAction(coordinates: Coordinates | null) {
  const result = await reportSiteArrivalDal(coordinates);
  return result.match(
    (outcome) => ({ success: true as const, data: outcome }),
    (e) => ({ success: false as const, error: e.reason }),
  );
}
