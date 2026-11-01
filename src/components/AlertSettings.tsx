"use client";

import {
  BellRing,
  CalendarDays,
  Coffee,
  Loader2,
  TimerOff,
  Users,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateAlertSettingsAction } from "@/lib/alert-actions";
import {
  ALERT_BOUNDS,
  normalizeAlertSettings,
  validateAlertSettings,
} from "@/lib/alerts";
import type { AlertSettingsData, AlertSettingsInput } from "@/lib/types";
import { Button, Card } from "./ui";

interface AlertSettingsProps {
  initialData: AlertSettingsData | null;
}

const inputClass =
  "h-12 w-full rounded-xl border-2 border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950";

type RuleProps = {
  id: string;
  icon: typeof BellRing;
  title: string;
  description: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  children?: React.ReactNode;
};

function Rule({
  id,
  icon: Icon,
  title,
  description,
  checked,
  onToggle,
  children,
}: RuleProps) {
  return (
    <div className="space-y-3 rounded-2xl border-2 border-zinc-200 p-5 dark:border-zinc-800">
      <label className="flex cursor-pointer items-start gap-3" htmlFor={id}>
        <input
          checked={checked}
          className="mt-1 h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
          id={id}
          onChange={(e) => onToggle(e.target.checked)}
          type="checkbox"
        />
        <span>
          <span className="flex items-center gap-2 font-bold">
            <Icon className="h-4 w-4" />
            {title}
          </span>
          <span className="block text-muted-foreground text-sm">
            {description}
          </span>
        </span>
      </label>
      {checked && children && <div className="pl-7">{children}</div>}
    </div>
  );
}

/**
 * Admin rules for "forgot to clock out" reminders, automatic clock-out and
 * "still on break" reminders. Long-running shifts otherwise inflate totals
 * silently, so every rule here acts on its own, from the server.
 */
export default function AlertSettings({ initialData }: AlertSettingsProps) {
  const [saved, setSaved] = useState<AlertSettingsInput>(() =>
    normalizeAlertSettings(initialData),
  );
  const [form, setForm] = useState<AlertSettingsInput>(saved);
  const [isPending, startTransition] = useTransition();

  const set = <K extends keyof AlertSettingsInput>(
    key: K,
    value: AlertSettingsInput[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const error = validateAlertSettings(form);
  const hasChanged = (Object.keys(form) as (keyof AlertSettingsInput)[]).some(
    (key) => form[key] !== saved[key],
  );

  const save = () => {
    startTransition(async () => {
      const res = await updateAlertSettingsAction(form);
      if (res.success) {
        setSaved(form);
        toast.success("Alert settings updated");
      } else {
        toast.error(res.error || "Update failed");
      }
    });
  };

  return (
    <Card className="p-8">
      <div className="mb-8">
        <h3 className="font-bold text-2xl tracking-tight">Shift Alerts</h3>
        <p className="text-muted-foreground">
          Catch forgotten punches before they inflate totals. Members choose
          email, push or both under Notifications.
        </p>
      </div>

      <div className="space-y-4">
        <Rule
          checked={form.forgot_clock_out_enabled}
          description="Remind members who are still clocked in after a long shift."
          icon={BellRing}
          id="alert-forgot-clock-out"
          onToggle={(v) => set("forgot_clock_out_enabled", v)}
          title="Forgot to clock out"
        >
          <label
            className="font-medium text-sm"
            htmlFor="forgot_clock_out_hours"
          >
            Remind after (hours)
          </label>
          <input
            className={inputClass}
            id="forgot_clock_out_hours"
            max={ALERT_BOUNDS.maxHours}
            min={ALERT_BOUNDS.minHours}
            onChange={(e) =>
              set("forgot_clock_out_hours", Number(e.target.value))
            }
            step="0.5"
            type="number"
            value={form.forgot_clock_out_hours}
          />
        </Rule>

        <Rule
          checked={form.auto_clock_out_enabled}
          description="Close shifts that run past a limit. The shift ends exactly at the limit, and the member is told."
          icon={TimerOff}
          id="alert-auto-clock-out"
          onToggle={(v) => set("auto_clock_out_enabled", v)}
          title="Automatic clock-out"
        >
          <label className="font-medium text-sm" htmlFor="auto_clock_out_hours">
            Clock out after (hours)
          </label>
          <input
            className={inputClass}
            id="auto_clock_out_hours"
            max={ALERT_BOUNDS.maxHours}
            min={ALERT_BOUNDS.minHours}
            onChange={(e) =>
              set("auto_clock_out_hours", Number(e.target.value))
            }
            step="0.5"
            type="number"
            value={form.auto_clock_out_hours}
          />
        </Rule>

        <Rule
          checked={form.break_reminder_enabled}
          description="Remind members who forgot to clock back in from a break. A break with a time limit is reminded when its limit runs out, if that comes first."
          icon={Coffee}
          id="alert-break-reminder"
          onToggle={(v) => set("break_reminder_enabled", v)}
          title="Forgot to end break"
        >
          <label
            className="font-medium text-sm"
            htmlFor="break_reminder_minutes"
          >
            Remind after (minutes)
          </label>
          <input
            className={inputClass}
            id="break_reminder_minutes"
            max={ALERT_BOUNDS.maxBreakMinutes}
            min={ALERT_BOUNDS.minBreakMinutes}
            onChange={(e) =>
              set("break_reminder_minutes", Number(e.target.value))
            }
            step={1}
            type="number"
            value={form.break_reminder_minutes}
          />
        </Rule>

        <Rule
          checked={form.schedule_notifications}
          description="Send members their schedule for the coming week on Sunday evening, remind them an hour before each shift, and tell them when a shift is added or removed."
          icon={CalendarDays}
          id="alert-schedule"
          onToggle={(v) => set("schedule_notifications", v)}
          title="Schedule notifications"
        />

        <Rule
          checked={form.notify_admins}
          description="Send a copy of every alert to the organization's admins."
          icon={Users}
          id="alert-notify-admins"
          onToggle={(v) => set("notify_admins", v)}
          title="Notify admins too"
        />
      </div>

      {error && (
        <p className="mt-4 text-red-600 text-sm dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="mt-8 flex justify-end">
        <Button
          className="h-12 px-8 font-bold"
          disabled={isPending || !hasChanged || Boolean(error)}
          onClick={save}
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Alert Settings
        </Button>
      </div>
    </Card>
  );
}
