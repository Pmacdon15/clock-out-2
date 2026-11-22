"use client";

import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import { toast } from "sonner";
import { trackArrival } from "@/lib/arrival";
import { reportSiteArrivalAction } from "@/lib/arrival-actions";
import type { ArrivalWatchConfig } from "@/lib/arrival-dal";
import type { Coordinates } from "@/lib/geo";
import type { SerializableResult } from "@/lib/types";

/** Cheap enough to leave running: reuse a recent fix, no rush for a new one. */
export const ARRIVAL_WATCH_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 60_000,
  timeout: 60_000,
} satisfies PositionOptions;

export const ARRIVAL_TOAST_ID = "arrival-prompt";

/**
 * Watches this device's position while Clock Out is open and, when the
 * member walks into one of the org's sites, asks the server to send "You've
 * arrived at <site>. Clock in?". When no push device took it, the same
 * question shows in-page instead.
 *
 * It never asks for location itself: watching starts only once the member
 * has already granted it (for example by clocking in with location on), and
 * stops if they revoke it. Renders nothing.
 */
export default function ArrivalPromptSync({
  configPromise,
}: {
  configPromise: Promise<SerializableResult<ArrivalWatchConfig, unknown>>;
}) {
  const result = use(configPromise);
  const config = result.ok ? result.value : null;
  const router = useRouter();

  useEffect(() => {
    if (!config?.enabled || config.sites.length === 0) return;
    const geolocation = navigator.geolocation;
    const permissions = navigator.permissions;
    if (!geolocation || !permissions?.query) return;

    const { sites } = config;
    let cancelled = false;
    let watchId: number | null = null;
    let insideSiteId: number | null | undefined;
    let status: PermissionStatus | null = null;

    const report = async (coordinates: Coordinates) => {
      const res = await reportSiteArrivalAction(coordinates);
      if (cancelled || !res.success) return;
      const outcome = res.data;
      if (outcome.status !== "prompted" || outcome.pushed > 0) return;
      toast(`You've arrived at ${outcome.siteName}. Clock in?`, {
        id: ARRIVAL_TOAST_ID,
        duration: 15_000,
        action: { label: "Clock in", onClick: () => router.push("/") },
      });
    };

    const onPosition = (position: GeolocationPosition) => {
      const coordinates: Coordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy ?? null,
      };
      const next = trackArrival(insideSiteId, coordinates, sites);
      insideSiteId = next.insideSiteId;
      if (!next.arrivedAt) return;
      report(coordinates).catch((error) => {
        console.error("Arrival report failed:", error);
      });
    };

    const start = () => {
      if (watchId !== null) return;
      watchId = geolocation.watchPosition(
        onPosition,
        // No fix right now is not worth telling anyone about; the watch
        // keeps trying.
        () => {},
        ARRIVAL_WATCH_OPTIONS,
      );
    };

    const stop = () => {
      if (watchId === null) return;
      geolocation.clearWatch(watchId);
      watchId = null;
      insideSiteId = undefined;
    };

    const sync = () => {
      if (status?.state === "granted") start();
      else stop();
    };

    permissions
      .query({ name: "geolocation" })
      .then((permission) => {
        if (cancelled) return;
        status = permission;
        status.addEventListener("change", sync);
        sync();
      })
      .catch((error) => {
        console.error("Location permission check failed:", error);
      });

    return () => {
      cancelled = true;
      status?.removeEventListener("change", sync);
      stop();
    };
  }, [config, router]);

  return null;
}
