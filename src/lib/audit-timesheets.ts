import { formatInTimeZone } from "date-fns-tz";
import {
  getBreakDurationMs,
  isMealBreakType,
  isPaidBreakType,
} from "./break-utils";
import { findNearestSite, formatMeters, type SiteLike } from "./geo";
import type { BreakSettingsData, TimeEntry } from "./types";

/*
 * Timesheet anomaly audit: pure detection rules over time entries that are
 * already loaded. No database, no clock (the caller passes `nowMs`), no
 * Clerk, so every rule can be unit tested on plain objects.
 *
 * Each finding carries, when there is a sensible correction, the exact
 * argument object for the `update_time_entry` MCP tool (`suggested_fix`), so
 * an AI client can show it to an admin and apply it unchanged.
 */

export const AUDIT_CHECKS = [
  "missed_clock_out",
  "long_shift",
  "overlapping_entries",
  "missed_meal_break",
  "punch_far_from_site",
  "edited_after_the_fact",
] as const;

export type AuditCheck = (typeof AUDIT_CHECKS)[number];

export type AuditSeverity = "high" | "medium" | "low";

/** Argument object for the `update_time_entry` MCP tool. */
export type UpdateTimeEntryFix = {
  org_id: string;
  entry_id: number;
  clock_in?: string;
  clock_out?: string;
  skip_lunch?: boolean;
  timezone: string;
};

export type AuditFinding = {
  type: AuditCheck;
  severity: AuditSeverity;
  employee: { user_id: string; name: string };
  entry_ids: number[];
  /** Local date (YYYY-MM-DD, in the audit's timezone) of the first entry's clock-in. */
  date: string;
  description: string;
  /** Exact `update_time_entry` input that would correct this, or null. */
  suggested_fix: UpdateTimeEntryFix | null;
  /** What to do instead (or check first) when there is no automatic fix. */
  fix_note: string;
  details: Record<string, unknown>;
};

export type AuditThresholds = {
  /** A completed shift longer than this is flagged (hours). */
  long_shift_hours: number;
  /** An open shift running longer than this is a missed clock-out (hours). */
  missed_clock_out_hours: number;
  /** Shifts at least this long need a meal period (hours). */
  meal_break_after_hours: number;
  /** Shortest meal period that satisfies the rule (minutes). */
  meal_break_min_minutes: number;
  /** How far beyond a site's geofence radius a punch may be (metres). */
  max_distance_meters: number;
  /** Slack between a punch and when it was written before it counts as an edit (minutes). */
  edit_grace_minutes: number;
  /** Shift length used to estimate a missing clock-out when the employee has no history (hours). */
  default_shift_hours: number;
};

export const DEFAULT_AUDIT_THRESHOLDS: AuditThresholds = {
  long_shift_hours: 12,
  missed_clock_out_hours: 12,
  meal_break_after_hours: 5,
  meal_break_min_minutes: 30,
  max_distance_meters: 250,
  edit_grace_minutes: 15,
  default_shift_hours: 8,
};

export type AuditCheckStatus = {
  type: AuditCheck;
  status: "ran" | "skipped";
  note: string;
};

export type AuditInput = {
  entries: TimeEntry[];
  /** Display names by user_id; unknown users fall back to their id. */
  employeeNames: Map<string, string>;
  timezone: string;
  nowMs: number;
  thresholds?: Partial<AuditThresholds>;
  /** Limit the audit to these rules (default: every rule). */
  checks?: readonly AuditCheck[];
  sites?: readonly SiteLike[];
  breakSettings?: Pick<
    BreakSettingsData,
    "dock_lunch" | "lunch_min_shift_hours" | "paid_lunch"
  > | null;
  /**
   * Hours after clock-in at which the org's automatic clock-out closes
   * shifts, or null when it has none. A shift closed exactly then was
   * a missed clock-out, closed by the system.
   */
  autoClockOutHours?: number | null;
};

export type AuditResult = {
  findings: AuditFinding[];
  checks: AuditCheckStatus[];
  thresholds: AuditThresholds;
  counts: {
    total: number;
    by_type: Record<AuditCheck, number>;
    by_severity: Record<AuditSeverity, number>;
  };
};

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const ms = (value: Date | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
};

const iso = (t: number) => new Date(t).toISOString();

const hours = (t: number) => Number((t / HOUR_MS).toFixed(2));

const SEVERITY_RANK: Record<AuditSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Thresholds with the caller's overrides, falling back to the org's lunch rule. */
export function resolveAuditThresholds(
  overrides?: Partial<AuditThresholds>,
  breakSettings?: AuditInput["breakSettings"],
): AuditThresholds {
  const orgMealHours = Number(breakSettings?.lunch_min_shift_hours);
  const base: AuditThresholds = {
    ...DEFAULT_AUDIT_THRESHOLDS,
    ...(orgMealHours > 0 ? { meal_break_after_hours: orgMealHours } : {}),
  };
  const out = { ...base };
  for (const key of Object.keys(base) as (keyof AuditThresholds)[]) {
    const value = overrides?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      out[key] = value;
    }
  }
  return out;
}

type Shift = {
  entry: TimeEntry;
  startMs: number;
  /** Clock-out, or null while the shift is open. */
  outMs: number | null;
  /** Clock-out, or now for an open shift. */
  endMs: number;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Runs every requested rule over the entries and returns findings sorted by
 * severity, then date. Entries with an unreadable clock-in are ignored.
 */
export function auditTimesheets(input: AuditInput): AuditResult {
  const tz = input.timezone;
  const thresholds = resolveAuditThresholds(
    input.thresholds,
    input.breakSettings,
  );
  const wanted = new Set<AuditCheck>(input.checks ?? AUDIT_CHECKS);
  const findings: AuditFinding[] = [];

  const byUser = new Map<string, Shift[]>();
  for (const entry of input.entries) {
    const startMs = ms(entry.clock_in);
    if (startMs === null) continue;
    const outMs = ms(entry.clock_out);
    const list = byUser.get(entry.user_id) ?? [];
    list.push({
      entry,
      startMs,
      outMs,
      endMs: outMs ?? Math.max(startMs, input.nowMs),
    });
    byUser.set(entry.user_id, list);
  }

  const autoHours = input.autoClockOutHours ?? null;
  const graceMs = thresholds.edit_grace_minutes * MINUTE_MS;

  /** Closed by the org's automatic clock-out: exactly N hours, written later. */
  const isAutoClosed = (s: Shift) => {
    if (autoHours === null || autoHours <= 0 || s.outMs === null) return false;
    const updated = ms(s.entry.updated_at);
    return (
      Math.abs(s.outMs - s.startMs - autoHours * HOUR_MS) < MINUTE_MS &&
      updated !== null &&
      updated - s.outMs > graceMs
    );
  };

  for (const [userId, shifts] of byUser) {
    shifts.sort((a, b) => a.startMs - b.startMs || a.entry.id - b.entry.id);
    const employee = {
      user_id: userId,
      name: input.employeeNames.get(userId) ?? userId,
    };
    const dateOf = (s: Shift) => formatInTimeZone(s.startMs, tz, "yyyy-MM-dd");
    const local = (t: number) => formatInTimeZone(t, tz, "yyyy-MM-dd HH:mm");
    const push = (
      type: AuditCheck,
      shift: Shift,
      rest: Omit<AuditFinding, "type" | "employee" | "date" | "entry_ids"> & {
        entry_ids?: number[];
      },
    ) => {
      findings.push({
        type,
        employee,
        date: dateOf(shift),
        entry_ids: rest.entry_ids ?? [shift.entry.id],
        severity: rest.severity,
        description: rest.description,
        suggested_fix: rest.suggested_fix,
        fix_note: rest.fix_note,
        details: rest.details,
      });
    };
    const fixFor = (
      s: Shift,
      fields: Omit<UpdateTimeEntryFix, "org_id" | "entry_id" | "timezone">,
    ): UpdateTimeEntryFix => ({
      org_id: s.entry.org_id,
      entry_id: s.entry.id,
      ...fields,
      timezone: tz,
    });

    // The employee's usual completed shift, for estimating a missing clock-out.
    const typicalMs =
      median(
        shifts
          .filter(
            (s) =>
              s.outMs !== null &&
              !isAutoClosed(s) &&
              s.outMs - s.startMs <= thresholds.long_shift_hours * HOUR_MS,
          )
          .map((s) => (s.outMs as number) - s.startMs),
      ) ?? thresholds.default_shift_hours * HOUR_MS;

    /** An estimated clock-out: usual length, but never into the next shift or the future. */
    const estimateClockOut = (s: Shift, index: number) => {
      const next = shifts[index + 1];
      let out = s.startMs + typicalMs;
      if (next) out = Math.min(out, next.startMs);
      out = Math.min(out, input.nowMs);
      return out > s.startMs ? out : null;
    };

    shifts.forEach((s, index) => {
      const durationMs = s.endMs - s.startMs;
      const autoClosed = isAutoClosed(s);

      /* ---------------------------------------------- missed clock-out -- */
      if (wanted.has("missed_clock_out")) {
        const laterShift = shifts[index + 1];
        const openTooLong =
          s.outMs === null &&
          (durationMs > thresholds.missed_clock_out_hours * HOUR_MS ||
            laterShift !== undefined);
        if (openTooLong || autoClosed) {
          const estimate = estimateClockOut(s, index);
          const why = autoClosed
            ? `was closed by the automatic clock-out exactly ${autoHours}h after clock-in (${local(s.startMs)}), so the real clock-out was never recorded`
            : laterShift
              ? `is still open even though a later shift (#${laterShift.entry.id}) started at ${local(laterShift.startMs)}`
              : `has been open for ${hours(durationMs)}h since ${local(s.startMs)}`;
          push("missed_clock_out", s, {
            severity: "high",
            description: `Shift #${s.entry.id} ${why}.`,
            suggested_fix: estimate
              ? fixFor(s, { clock_out: iso(estimate) })
              : null,
            fix_note: estimate
              ? `Estimated clock-out ${local(estimate)} from the employee's usual ${hours(typicalMs)}h shift. Confirm the real time with the employee before applying.`
              : "Ask the employee when they actually finished, then set clock_out with update_time_entry.",
            details: {
              clock_in: iso(s.startMs),
              clock_out: s.outMs === null ? null : iso(s.outMs),
              hours_open: hours(durationMs),
              closed_automatically: autoClosed,
              estimated_clock_out: estimate ? iso(estimate) : null,
            },
          });
        }
      }

      /* ---------------------------------------------------- long shift -- */
      if (
        wanted.has("long_shift") &&
        s.outMs !== null &&
        !autoClosed &&
        durationMs > thresholds.long_shift_hours * HOUR_MS
      ) {
        const estimate = s.startMs + typicalMs;
        const shorter = estimate < s.outMs;
        push("long_shift", s, {
          severity:
            durationMs > Math.max(16, thresholds.long_shift_hours) * HOUR_MS
              ? "high"
              : "medium",
          description: `Shift #${s.entry.id} lasted ${hours(durationMs)}h (${local(s.startMs)} to ${local(s.outMs)}), over the ${thresholds.long_shift_hours}h limit.`,
          suggested_fix: shorter
            ? fixFor(s, { clock_out: iso(estimate) })
            : null,
          fix_note: shorter
            ? `If the employee forgot to clock out, this sets clock-out to ${local(estimate)} (their usual ${hours(typicalMs)}h shift). Only apply after confirming; a genuinely long shift needs no change.`
            : "Confirm the shift really was this long; no change needed if it was.",
          details: {
            clock_in: iso(s.startMs),
            clock_out: iso(s.outMs),
            hours: hours(durationMs),
            threshold_hours: thresholds.long_shift_hours,
          },
        });
      }

      /* ------------------------------------------ overlapping entries -- */
      if (wanted.has("overlapping_entries")) {
        const overlapping = shifts
          .slice(index + 1)
          .filter((o) => o.startMs < s.endMs);
        const first = overlapping[0];
        if (first) {
          const contained = first.endMs <= s.endMs;
          const sameStart = first.startMs <= s.startMs;
          const canTrim = !contained && !sameStart;
          push("overlapping_entries", s, {
            severity: "high",
            entry_ids: [s.entry.id, ...overlapping.map((o) => o.entry.id)],
            description: `Shift #${s.entry.id} (${local(s.startMs)} to ${s.outMs === null ? "still open" : local(s.outMs)}) overlaps ${overlapping.map((o) => `#${o.entry.id}`).join(", ")}, so the same time is counted twice.`,
            suggested_fix: canTrim
              ? fixFor(s, { clock_out: iso(first.startMs) })
              : null,
            fix_note: canTrim
              ? `Ends #${s.entry.id} when #${first.entry.id} starts (${local(first.startMs)}), which removes every overlap listed.`
              : `#${first.entry.id} lies entirely inside #${s.entry.id} (or starts at the same time), so it is probably a duplicate: confirm, then remove it with delete_time_entry (entry_id ${first.entry.id}).`,
            details: {
              overlap_minutes: Math.round(
                (Math.min(s.endMs, first.endMs) - first.startMs) / MINUTE_MS,
              ),
              likely_duplicate: !canTrim,
            },
          });
        }
      }

      /* ------------------------------------------- missed meal break -- */
      if (
        wanted.has("missed_meal_break") &&
        s.outMs !== null &&
        !autoClosed &&
        durationMs >= thresholds.meal_break_after_hours * HOUR_MS
      ) {
        const mealMs = (s.entry.breaks ?? [])
          .filter((b) => isMealBreakType(b.break_type) && b.break_end)
          .reduce((sum, b) => sum + getBreakDurationMs(b), 0);
        const mealMinutes = Math.round(mealMs / MINUTE_MS);
        const minMinutes = thresholds.meal_break_min_minutes;
        const hasUnpaidRecord = (s.entry.breaks ?? []).some(
          (b) => !isPaidBreakType(b.break_type),
        );
        const docks =
          Boolean(input.breakSettings?.dock_lunch) &&
          !input.breakSettings?.paid_lunch;
        // With the automatic lunch dock on, an unmarked shift is assumed to
        // have had lunch, which is what the dock deducts.
        const assumedTaken =
          mealMs === 0 && docks && !s.entry.skip_lunch && !hasUnpaidRecord;

        if (mealMinutes < minMinutes && !assumedTaken) {
          const base = `Shift #${s.entry.id} lasted ${hours(durationMs)}h`;
          let description: string;
          let suggested_fix: UpdateTimeEntryFix | null = null;
          let fix_note: string;
          let severity: AuditSeverity = "medium";
          if (mealMs > 0) {
            severity = "low";
            description = `${base} but its meal break was only ${mealMinutes} min (rule: ${minMinutes} min after ${thresholds.meal_break_after_hours}h).`;
            fix_note =
              "If the break was really longer, correct it with manage_breaks (action 'update'); otherwise this is a short meal period to review.";
          } else if (s.entry.skip_lunch) {
            description = `${base} and is marked "skipped lunch", so no meal break was taken (rule: ${minMinutes} min after ${thresholds.meal_break_after_hours}h).`;
            if (docks) {
              suggested_fix = fixFor(s, { skip_lunch: false });
              fix_note =
                "Only if the employee actually took lunch: this clears the skipped-lunch flag so the automatic lunch deduction applies. If lunch really was skipped, leave the entry and follow your meal-break policy.";
            } else {
              fix_note =
                "If lunch was taken, record it with manage_breaks (action 'add', break_type 'unpaid_meal'); otherwise follow your meal-break policy.";
            }
          } else {
            description = `${base} with no meal break recorded (rule: ${minMinutes} min after ${thresholds.meal_break_after_hours}h).`;
            fix_note =
              "If lunch was taken, record it with manage_breaks (action 'add', break_type 'unpaid_meal' with the actual times); otherwise follow your meal-break policy.";
          }
          push("missed_meal_break", s, {
            severity,
            description,
            suggested_fix,
            fix_note,
            details: {
              hours: hours(durationMs),
              meal_break_minutes: mealMinutes,
              skip_lunch: Boolean(s.entry.skip_lunch),
              required_after_hours: thresholds.meal_break_after_hours,
              required_minutes: minMinutes,
            },
          });
        }
      }

      /* ------------------------------------------ punch far from site -- */
      if (wanted.has("punch_far_from_site") && input.sites?.length) {
        const punches = [
          {
            kind: "clock_in" as const,
            latitude: s.entry.clock_in_latitude,
            longitude: s.entry.clock_in_longitude,
            accuracy: s.entry.clock_in_accuracy_m,
          },
          {
            kind: "clock_out" as const,
            latitude: s.entry.clock_out_latitude,
            longitude: s.entry.clock_out_longitude,
            accuracy: s.entry.clock_out_accuracy_m,
          },
        ];
        for (const p of punches) {
          if (typeof p.latitude !== "number" || typeof p.longitude !== "number")
            continue;
          const nearest = findNearestSite(
            { latitude: p.latitude, longitude: p.longitude },
            input.sites,
          );
          if (!nearest || nearest.within) continue;
          const radius = Number(nearest.site.radius_meters) || 0;
          const accuracy =
            typeof p.accuracy === "number" && p.accuracy > 0 ? p.accuracy : 0;
          const beyond = nearest.distanceMeters - radius - accuracy;
          if (beyond <= thresholds.max_distance_meters) continue;
          const label = p.kind === "clock_in" ? "Clock-in" : "Clock-out";
          push("punch_far_from_site", s, {
            severity: beyond > 5000 ? "high" : "medium",
            description: `${label} of shift #${s.entry.id} was ${formatMeters(nearest.distanceMeters)} from the nearest work site (${nearest.site.name}), ${formatMeters(beyond)} outside its geofence.`,
            suggested_fix: null,
            fix_note:
              "Punch locations can't be edited. Check with the employee where they were working (e.g. an off-site job) and whether the shift's hours are legitimate.",
            details: {
              punch: p.kind,
              latitude: p.latitude,
              longitude: p.longitude,
              accuracy_m: accuracy || null,
              nearest_site: nearest.site.name,
              distance_m: Math.round(nearest.distanceMeters),
              beyond_geofence_m: Math.round(beyond),
            },
          });
        }
      }

      /* ---------------------------------------- edited after the fact -- */
      if (wanted.has("edited_after_the_fact") && !autoClosed) {
        const created = ms(s.entry.created_at);
        const updated = ms(s.entry.updated_at);
        const reasons: string[] = [];
        if (created !== null && created - s.startMs > graceMs) {
          reasons.push(
            `entered ${hours(created - s.startMs)}h after its clock-in time (added manually or back-dated)`,
          );
        }
        if (updated !== null && created !== null) {
          const settled = Math.max(created, s.outMs ?? created);
          if (updated - settled > graceMs) {
            reasons.push(
              `changed on ${local(updated)}, after the ${s.outMs === null ? "shift was opened" : "shift ended"}`,
            );
          }
        }
        const lateBreaks = (s.entry.breaks ?? []).filter((b) => {
          const bCreated = ms(b.created_at);
          const bStart = ms(b.break_start);
          return (
            bCreated !== null && bStart !== null && bCreated - bStart > graceMs
          );
        });
        if (lateBreaks.length > 0) {
          reasons.push(
            `has break${lateBreaks.length === 1 ? "" : "s"} ${lateBreaks.map((b) => `#${b.id}`).join(", ")} added after the fact`,
          );
        }
        if (reasons.length > 0) {
          push("edited_after_the_fact", s, {
            severity: "low",
            description: `Shift #${s.entry.id} was ${reasons.join("; ")}.`,
            suggested_fix: null,
            fix_note:
              "Nothing to correct automatically: confirm the change was authorised and matches what was worked.",
            details: {
              created_at: created === null ? null : iso(created),
              updated_at: updated === null ? null : iso(updated),
              late_break_ids: lateBreaks.map((b) => b.id),
            },
          });
        }
      }
    });
  }

  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.date.localeCompare(b.date) ||
      (a.entry_ids[0] as number) - (b.entry_ids[0] as number),
  );

  const by_type = Object.fromEntries(
    AUDIT_CHECKS.map((t) => [t, findings.filter((f) => f.type === t).length]),
  ) as Record<AuditCheck, number>;
  const by_severity: Record<AuditSeverity, number> = {
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
  };

  const checks: AuditCheckStatus[] = AUDIT_CHECKS.map((type) => {
    if (!wanted.has(type)) {
      return { type, status: "skipped", note: "Not requested." };
    }
    if (type === "punch_far_from_site" && !input.sites?.length) {
      return {
        type,
        status: "skipped",
        note: "The organization has no work sites, so punch locations can't be compared with a work location.",
      };
    }
    if (type === "edited_after_the_fact") {
      return {
        type,
        status: "ran",
        note: "Inferred from created/updated timestamps; Clock Out keeps no edit history, so who changed an entry and its previous values aren't known.",
      };
    }
    return { type, status: "ran", note: "" };
  });

  return {
    findings,
    checks,
    thresholds,
    counts: { total: findings.length, by_type, by_severity },
  };
}
