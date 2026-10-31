"use client";

import { useMutation } from "@tanstack/react-query";
import {
  Check,
  Crosshair,
  Loader2,
  MapPin,
  MapPinOff,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { startTransition, useState } from "react";
import { toast } from "sonner";
import {
  createSiteAction,
  deleteSiteAction,
  reverseGeocodeAction,
  searchAddressAction,
  updateLocationSettingsAction,
  updateSiteAction,
} from "@/lib/actions";
import { captureCurrentPosition } from "@/lib/geolocation";
import type { LocationSettingsData, SiteData } from "@/lib/types";
import { Button, Card } from "./ui";

interface LocationSettingsProps {
  initialData: LocationSettingsData | null;
  sites: SiteData[];
  /** False when the org's plan does not include the `geofencing` feature. */
  hasGeofencing: boolean;
  onUpdateOptimistic: (next: Partial<LocationSettingsData>) => void;
}

const options = [
  {
    id: "off",
    label: "Do Not Capture Location",
    description: "No coordinates are requested or stored. This is the default.",
    icon: MapPinOff,
  },
  {
    id: "optional",
    label: "Capture Location When Available",
    description:
      "Record where a punch happened when the member's browser shares it, but never block a punch.",
    icon: MapPin,
  },
  {
    id: "required",
    label: "Require Location",
    description:
      "A member must share their location to clock in. Punches without coordinates are refused.",
    icon: ShieldCheck,
  },
] as const;

const DEFAULT_RADIUS = 150;

type SiteDraft = {
  name: string;
  latitude: string;
  longitude: string;
  radius: string;
  address: string;
};

const emptyDraft: SiteDraft = {
  name: "",
  latitude: "",
  longitude: "",
  radius: String(DEFAULT_RADIUS),
  address: "",
};

/** An empty field is "not given"; anything else goes to the server to judge. */
const parseField = (value: string) =>
  value.trim() === "" ? null : Number(value);

const draftFromSite = (site: SiteData): SiteDraft => ({
  name: site.name,
  latitude: String(site.latitude),
  longitude: String(site.longitude),
  radius: String(site.radius_meters),
  address: site.address ?? "",
});

export default function LocationSettings({
  initialData,
  sites,
  hasGeofencing,
  onUpdateOptimistic,
}: LocationSettingsProps) {
  const [captureMode, setCaptureMode] = useState<string>(
    initialData?.capture_mode ?? "off",
  );
  const [restrictClockIn, setRestrictClockIn] = useState<boolean>(
    initialData?.restrict_clock_in ?? false,
  );
  const [draft, setDraft] = useState<SiteDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [addressQuery, setAddressQuery] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState<
    Array<{
      formatted: string;
      latitude: number;
      longitude: number;
      addressLine1?: string;
    }>
  >([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);

  const settingsMutation = useMutation({
    mutationFn: ({ mode, restrict }: { mode: string; restrict: boolean }) =>
      updateLocationSettingsAction(mode, restrict),
    onSuccess: (res) => {
      if (res.success) {
        toast.success("Location settings updated");
      } else if ("error" in res) {
        toast.error(res.error || "Update failed");
      }
    },
  });

  const saveSiteMutation = useMutation({
    mutationFn: async ({
      id,
      name,
      latitude,
      longitude,
      radius,
      address,
    }: {
      id: number | null;
      name: string;
      latitude: number;
      longitude: number;
      radius: number;
      address?: string | null;
    }) => {
      // Create and update report different error unions; flatten them so the
      // mutation has one result shape.
      const res =
        id === null
          ? await createSiteAction(
              name,
              latitude,
              longitude,
              radius,
              ...(address ? [address] : []),
            )
          : await updateSiteAction(
              id,
              name,
              latitude,
              longitude,
              radius,
              ...(address ? [address] : []),
            );
      return {
        success: res.success,
        error: "error" in res ? res.error : undefined,
      };
    },
    onSuccess: (res) => {
      if (res.success) {
        toast.success("Site saved");
        setDraft(emptyDraft);
        setAddressQuery("");
        setAddressSuggestions([]);
        setEditingId(null);
      } else {
        toast.error(res.error || "Failed to save site");
      }
    },
  });

  const deleteSiteMutation = useMutation({
    mutationFn: (id: number) => deleteSiteAction(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success("Site removed");
      } else if ("error" in res) {
        toast.error(res.error || "Failed to remove site");
      }
    },
  });

  if (!hasGeofencing) {
    return (
      <Card className="p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
          <MapPin className="h-6 w-6 text-zinc-400" />
        </div>
        <h3 className="mb-2 font-bold text-xl">Premium Feature</h3>
        <p className="mx-auto max-w-sm text-muted-foreground">
          Location capture and geofenced clock-in are only available on paid
          plans. Upgrade your organization to unlock this feature.
        </p>
        <Link className="mt-6 inline-block" href="/plans">
          <Button variant="outline">View Plans</Button>
        </Link>
      </Card>
    );
  }

  const hasChanged =
    !initialData ||
    captureMode !== initialData.capture_mode ||
    restrictClockIn !== initialData.restrict_clock_in;

  const useMyLocation = async () => {
    setIsLocating(true);
    const capture = await captureCurrentPosition();
    if (!capture.ok) {
      setIsLocating(false);
      toast.error(capture.failure.message);
      return;
    }
    const lat = capture.coordinates.latitude;
    const lon = capture.coordinates.longitude;
    const geoRes = await reverseGeocodeAction(lat, lon);
    setIsLocating(false);

    const resolvedAddress =
      geoRes && "success" in geoRes && geoRes.success && geoRes.data
        ? geoRes.data
        : "";
    setDraft((current) => ({
      ...current,
      name:
        current.name.trim() === "" && resolvedAddress
          ? resolvedAddress
          : current.name,
      latitude: lat.toFixed(6),
      longitude: lon.toFixed(6),
      address: resolvedAddress || current.address,
    }));
    if (resolvedAddress) {
      setAddressQuery(resolvedAddress);
    }
  };

  const handleAddressSearch = async (val: string) => {
    setAddressQuery(val);
    if (val.trim().length < 3) {
      setAddressSuggestions([]);
      return;
    }
    setIsSearchingAddress(true);
    const res = await searchAddressAction(val);
    setIsSearchingAddress(false);
    if (res.success && Array.isArray(res.data)) {
      setAddressSuggestions(res.data);
    } else {
      setAddressSuggestions([]);
    }
  };

  const handleSelectSuggestion = (suggestion: {
    formatted: string;
    latitude: number;
    longitude: number;
    addressLine1?: string;
  }) => {
    setDraft((curr) => ({
      ...curr,
      name:
        curr.name.trim() === ""
          ? suggestion.addressLine1 || suggestion.formatted
          : curr.name,
      latitude: suggestion.latitude.toFixed(6),
      longitude: suggestion.longitude.toFixed(6),
      address: suggestion.formatted,
    }));
    setAddressQuery(suggestion.formatted);
    setAddressSuggestions([]);
  };

  const saveSite = () => {
    const latitude = parseField(draft.latitude);
    const longitude = parseField(draft.longitude);

    if (!draft.name.trim()) {
      toast.error("Give the site a name");
      return;
    }
    if (latitude === null || longitude === null) {
      toast.error("Enter a latitude and longitude for the site");
      return;
    }

    saveSiteMutation.mutate({
      id: editingId,
      name: draft.name,
      latitude,
      longitude,
      radius: parseField(draft.radius) ?? DEFAULT_RADIUS,
      address: draft.address.trim() || undefined,
    });
  };

  return (
    <Card className="p-8">
      <div className="mb-8">
        <h3 className="font-bold text-2xl tracking-tight">
          Location &amp; Work Sites
        </h3>
        <p className="text-muted-foreground">
          Optionally record where a punch happened, and limit clock-in to the
          sites you define. Coordinates are only ever requested while this is
          switched on, and the check always runs on the server.
        </p>
      </div>

      <div className="space-y-4">
        {options.map((option) => (
          <button
            className={`flex w-full items-center justify-between rounded-2xl border-2 p-6 text-left transition-all ${
              captureMode === option.id
                ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900"
                : "border-transparent bg-zinc-100/50 hover:bg-zinc-100 dark:bg-zinc-800/50 dark:hover:bg-zinc-800"
            }`}
            key={option.id}
            onClick={() => setCaptureMode(option.id)}
            type="button"
          >
            <div className="flex items-center gap-4">
              <div
                className={`rounded-xl p-2 ${captureMode === option.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black" : "bg-zinc-200 dark:bg-zinc-700"}`}
              >
                <option.icon className="h-5 w-5" />
              </div>
              <div>
                <div className="font-bold text-lg">{option.label}</div>
                <div className="text-muted-foreground text-sm">
                  {option.description}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {captureMode === option.id && (
                <div className="rounded-full bg-zinc-900 p-1 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
                  <Check className="h-4 w-4" />
                </div>
              )}
              {initialData?.capture_mode === option.id && (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-[10px] text-zinc-500 uppercase dark:bg-zinc-800">
                  Current
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      <label
        className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-transparent bg-zinc-100/50 p-6 dark:bg-zinc-800/50"
        htmlFor="restrictClockIn"
      >
        <input
          checked={restrictClockIn}
          className="mt-1 h-4 w-4 rounded border-zinc-300 accent-zinc-900 dark:accent-zinc-100"
          id="restrictClockIn"
          onChange={(e) => setRestrictClockIn(e.target.checked)}
          type="checkbox"
        />
        <span>
          <span className="block font-bold text-lg">
            Restrict clock-in to my work sites
          </span>
          <span className="block text-muted-foreground text-sm">
            A clock-in outside every site's radius is refused. Clocking out is
            never blocked. Members must share their location while this is on,
            and the restriction only applies once at least one site exists.
          </span>
        </span>
      </label>

      <div className="mt-8 flex justify-end">
        <Button
          className="h-12 px-8 font-bold"
          disabled={settingsMutation.isPending || !hasChanged}
          onClick={() => {
            startTransition(async () => {
              if (initialData) {
                onUpdateOptimistic({
                  ...initialData,
                  capture_mode: captureMode,
                  restrict_clock_in: restrictClockIn,
                });
              }

              await settingsMutation.mutate({
                mode: captureMode,
                restrict: restrictClockIn,
              });
            });
          }}
        >
          {settingsMutation.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Save Location Settings
        </Button>
      </div>

      <div className="mt-10 border-zinc-100 border-t pt-8 dark:border-zinc-800">
        <h4 className="font-bold text-lg">Work Sites</h4>
        <p className="mb-4 text-muted-foreground text-sm">
          Each site is a point and a radius in metres. A clock-in counts as
          on-site when it falls inside any one of them.
        </p>

        {sites.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-muted-foreground text-sm">
            No sites yet. Add one below.
          </p>
        ) : (
          <ul className="space-y-2">
            {sites.map((site) => (
              <li
                className="flex items-center justify-between rounded-xl border p-4"
                key={site.id}
              >
                <div className="flex flex-col">
                  <span className="font-semibold">{site.name}</span>
                  {site.address && (
                    <span className="text-muted-foreground text-xs">
                      {site.address}
                    </span>
                  )}
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {Number(site.latitude).toFixed(5)},{" "}
                    {Number(site.longitude).toFixed(5)} ·{" "}
                    {Math.round(Number(site.radius_meters))} m
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => {
                      setEditingId(site.id);
                      setDraft(draftFromSite(site));
                      setAddressQuery(site.address ?? "");
                      setAddressSuggestions([]);
                    }}
                    size="sm"
                    variant="outline"
                  >
                    Edit
                  </Button>
                  <button
                    aria-label={`Remove ${site.name}`}
                    className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                    disabled={deleteSiteMutation.isPending}
                    onClick={() => deleteSiteMutation.mutate(site.id)}
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 space-y-4 rounded-2xl bg-zinc-100/50 p-6 dark:bg-zinc-800/50">
          <div className="flex items-center justify-between">
            <span className="font-bold">
              {editingId === null ? "Add a site" : "Edit site"}
            </span>
            {editingId !== null && (
              <button
                aria-label="Cancel editing"
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                onClick={() => {
                  setEditingId(null);
                  setDraft(emptyDraft);
                  setAddressQuery("");
                  setAddressSuggestions([]);
                }}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <label className="font-medium text-sm" htmlFor="addressSearch">
                Find address
              </label>
              <div className="relative">
                <div className="relative flex items-center">
                  <Search className="absolute left-3.5 h-4 w-4 text-muted-foreground" />
                  <input
                    className="h-12 w-full rounded-xl border-2 border-zinc-200 bg-white pl-10 pr-10 dark:border-zinc-800 dark:bg-zinc-950"
                    id="addressSearch"
                    onChange={(e) => handleAddressSearch(e.target.value)}
                    placeholder="Search street address to auto-fill..."
                    type="text"
                    value={addressQuery}
                  />
                  {isSearchingAddress && (
                    <Loader2 className="absolute right-3.5 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
                {addressSuggestions.length > 0 && (
                  <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
                    {addressSuggestions.map((s) => (
                      <li key={`${s.formatted}-${s.latitude}-${s.longitude}`}>
                        <button
                          className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
                          onClick={() => handleSelectSuggestion(s)}
                          type="button"
                        >
                          <div className="font-medium">
                            {s.addressLine1 || s.formatted}
                          </div>
                          <div className="text-muted-foreground text-xs">
                            {s.formatted}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="font-medium text-sm" htmlFor="siteName">
                Site name
              </label>
              <input
                className="h-12 w-full rounded-xl border-2 border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950"
                id="siteName"
                onChange={(e) =>
                  setDraft((current) => ({ ...current, name: e.target.value }))
                }
                placeholder="Main warehouse"
                type="text"
                value={draft.name}
              />
            </div>
            <div className="space-y-2">
              <label className="font-medium text-sm" htmlFor="siteLatitude">
                Latitude
              </label>
              <input
                className="h-12 w-full rounded-xl border-2 border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950"
                id="siteLatitude"
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    latitude: e.target.value,
                  }))
                }
                step="any"
                type="number"
                value={draft.latitude}
              />
            </div>
            <div className="space-y-2">
              <label className="font-medium text-sm" htmlFor="siteLongitude">
                Longitude
              </label>
              <input
                className="h-12 w-full rounded-xl border-2 border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950"
                id="siteLongitude"
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    longitude: e.target.value,
                  }))
                }
                step="any"
                type="number"
                value={draft.longitude}
              />
            </div>
            <div className="space-y-2">
              <label className="font-medium text-sm" htmlFor="siteRadius">
                Radius (metres)
              </label>
              <input
                className="h-12 w-full rounded-xl border-2 border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950"
                id="siteRadius"
                min={0}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    radius: e.target.value,
                  }))
                }
                type="number"
                value={draft.radius}
              />
            </div>
            <div className="flex items-end">
              <Button
                className="h-12 w-full gap-2"
                disabled={isLocating}
                onClick={useMyLocation}
                type="button"
                variant="outline"
              >
                {isLocating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Crosshair className="h-4 w-4" />
                )}
                Use my location
              </Button>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              className="h-12 gap-2 px-8 font-bold"
              disabled={saveSiteMutation.isPending}
              onClick={saveSite}
            >
              {saveSiteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {editingId === null ? "Add Site" : "Save Site"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
