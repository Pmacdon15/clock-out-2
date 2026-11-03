"use client";

import {
  Bell,
  BellOff,
  Loader2,
  Mail,
  Send,
  Share,
  Smartphone,
} from "lucide-react";
import Link from "next/link";
import { use, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  deletePushSubscriptionAction,
  savePushSubscriptionAction,
  sendTestNotificationAction,
  updateNotificationPreferencesAction,
} from "@/lib/alert-actions";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/alerts";
import type { NotificationSettingsView } from "@/lib/alerts-dal";
import {
  getCurrentSubscription,
  getPushSupport,
  type PushSupport,
  subscribeThisDevice,
  toSubscriptionInput,
} from "@/lib/push-client";
import type {
  NotificationPreferencesInput,
  SerializableResult,
} from "@/lib/types";
import { Button, Card } from "./ui";

interface NotificationSettingsProps {
  settingsPromise: Promise<
    SerializableResult<NotificationSettingsView, { reason: string }>
  >;
  isAdmin: boolean;
  /** False when the org's plan does not include the `notifications` feature. */
  hasNotifications: boolean;
}

type Toggle = {
  key: keyof NotificationPreferencesInput;
  label: string;
  description: string;
  adminOnly?: boolean;
};

const CHANNELS: Toggle[] = [
  {
    key: "email_enabled",
    label: "Email",
    description: "Sent to the email address on your account.",
  },
  {
    key: "push_enabled",
    label: "Push notifications",
    description: "Sent to every device you turn on below.",
  },
];

const TOPICS: Toggle[] = [
  {
    key: "shift_alerts",
    label: "Forgot to clock out",
    description:
      "When you've been clocked in for a long time, or were clocked out automatically.",
  },
  {
    key: "break_alerts",
    label: "Forgot to end break",
    description: "When a break runs long or reaches its time limit.",
  },
  {
    key: "schedule_alerts",
    label: "My schedule",
    description:
      "Your schedule for the coming week (Sunday evening), a reminder an hour before each shift, and shifts added or removed.",
  },
  {
    key: "admin_alerts",
    label: "Team alerts",
    description: "Alerts about members of organizations you administer.",
    adminOnly: true,
  },
];

function ToggleRow({
  toggle,
  checked,
  onChange,
}: {
  toggle: Toggle;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = `pref-${toggle.key}`;
  return (
    <label className="flex cursor-pointer items-start gap-3" htmlFor={id}>
      <input
        checked={checked}
        className="mt-1 h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
        id={id}
        onChange={(e) => onChange(e.target.checked)}
        type="checkbox"
      />
      <span>
        <span className="block font-medium">{toggle.label}</span>
        <span className="block text-muted-foreground text-sm">
          {toggle.description}
        </span>
      </span>
    </label>
  );
}

/** Where each person turns alerts on or off, and picks email, push or both. */
export default function NotificationSettings({
  settingsPromise,
  isAdmin,
  hasNotifications,
}: NotificationSettingsProps) {
  const result = use(settingsPromise);
  const view = result.ok ? result.value : null;

  const initial = view?.preferences ?? DEFAULT_NOTIFICATION_PREFERENCES;
  const [saved, setSaved] = useState<NotificationPreferencesInput>(initial);
  const [form, setForm] = useState<NotificationPreferencesInput>(initial);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null,
  );
  const [isSaving, startSaving] = useTransition();
  const [isDeviceBusy, startDevice] = useTransition();
  const [isTesting, startTest] = useTransition();

  const pushAvailable = Boolean(view?.vapidPublicKey);

  useEffect(() => {
    const detected = getPushSupport();
    setSupport(detected);
    if (detected !== "supported" || !pushAvailable) return;
    getCurrentSubscription()
      .then(setSubscription)
      .catch(() => setSubscription(null));
  }, [pushAvailable]);

  if (!hasNotifications) {
    return (
      <Card className="p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
          <Bell className="h-6 w-6 text-zinc-400" />
        </div>
        <h3 className="mb-2 font-bold text-xl">Premium Feature</h3>
        <p className="mx-auto max-w-sm text-muted-foreground">
          Email and push notifications are only available on paid plans. Upgrade
          your organization to unlock this feature.
        </p>
        <Link className="mt-6 inline-block" href="/plans">
          <Button variant="outline">View Plans</Button>
        </Link>
      </Card>
    );
  }

  if (!result.ok) {
    return (
      <Card className="p-8 text-center text-red-500">
        {result.error.reason}
      </Card>
    );
  }
  const settings = result.value;

  const hasChanged = (
    Object.keys(form) as (keyof NotificationPreferencesInput)[]
  ).some((key) => form[key] !== saved[key]);

  const save = () => {
    startSaving(async () => {
      const res = await updateNotificationPreferencesAction(form);
      if (res.success) {
        setSaved(form);
        toast.success("Notification preferences saved");
      } else {
        toast.error(res.error || "Update failed");
      }
    });
  };

  const enableDevice = () => {
    startDevice(async () => {
      try {
        const sub = await subscribeThisDevice(
          settings.vapidPublicKey as string,
        );
        if (!sub) {
          toast.error(
            "Notifications are blocked. Allow them in your browser or device settings.",
          );
          return;
        }
        const res = await savePushSubscriptionAction(
          toSubscriptionInput(sub),
          navigator.userAgent,
        );
        if (!res.success) {
          toast.error(res.error || "Could not save this device");
          return;
        }
        setSubscription(sub);
        toast.success("Push notifications are on for this device");
      } catch (error) {
        console.error("Push subscribe failed:", error);
        toast.error("Could not turn on push notifications here");
      }
    });
  };

  const disableDevice = () => {
    startDevice(async () => {
      const current = subscription as PushSubscription;
      try {
        await current.unsubscribe();
      } catch (error) {
        console.error("Push unsubscribe failed:", error);
      }
      await deletePushSubscriptionAction(current.endpoint);
      setSubscription(null);
      toast.success("Push notifications are off for this device");
    });
  };

  const sendTest = () => {
    startTest(async () => {
      const res = await sendTestNotificationAction();
      if (!res.success) {
        toast.error(res.error || "Test failed");
        return;
      }
      const { email, push } = res.data;
      if (email + push === 0) {
        toast.error(
          "Nothing was sent. Turn on a channel above, save, and try again.",
        );
        return;
      }
      toast.success(
        `Test sent: ${email} email${email === 1 ? "" : "s"}, ${push} push${push === 1 ? "" : "es"}`,
      );
    });
  };

  return (
    <Card className="p-8">
      <div className="mb-8">
        <h3 className="font-bold text-2xl tracking-tight">Notifications</h3>
        <p className="text-muted-foreground">
          Choose how you hear about forgotten punches. Alerts only go out when
          your organization has turned them on.
        </p>
      </div>

      <div className="space-y-8">
        <section className="space-y-4">
          <h4 className="font-bold text-lg">Send alerts by</h4>
          {CHANNELS.map((toggle) => (
            <ToggleRow
              checked={form[toggle.key]}
              key={toggle.key}
              onChange={(v) => setForm({ ...form, [toggle.key]: v })}
              toggle={toggle}
            />
          ))}
          {!settings.emailAvailable && (
            <p className="text-muted-foreground text-sm">
              <Mail className="mr-1 inline h-4 w-4" />
              Email isn't configured on this server yet.
            </p>
          )}
        </section>

        <section className="space-y-4">
          <h4 className="font-bold text-lg">Alert me about</h4>
          {TOPICS.filter((t) => isAdmin || !t.adminOnly).map((toggle) => (
            <ToggleRow
              checked={form[toggle.key]}
              key={toggle.key}
              onChange={(v) => setForm({ ...form, [toggle.key]: v })}
              toggle={toggle}
            />
          ))}
        </section>

        <div className="flex justify-end">
          <Button
            className="h-12 px-8 font-bold"
            disabled={isSaving || !hasChanged}
            onClick={save}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Preferences
          </Button>
        </div>

        <section
          className="space-y-4 rounded-2xl border-2 border-zinc-200 p-6 dark:border-zinc-800"
          data-testid="this-device"
        >
          <h4 className="flex items-center gap-2 font-bold text-lg">
            <Smartphone className="h-5 w-5" />
            This device
          </h4>
          {!pushAvailable ? (
            <p className="text-muted-foreground text-sm">
              Push notifications aren't configured on this server yet.
            </p>
          ) : support === "ios-needs-install" ? (
            <p className="text-muted-foreground text-sm">
              On iPhone and iPad, tap <Share className="inline h-4 w-4" />{" "}
              Share, then <strong>Add to Home Screen</strong>. Open Clock Out
              from your Home Screen and come back here to turn on push.
            </p>
          ) : support === "unsupported" ? (
            <p className="text-muted-foreground text-sm">
              This browser can't receive push notifications.
            </p>
          ) : support === null ? null : subscription ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                <Bell className="mr-1 inline h-4 w-4" />
                Push notifications are on for this device.
              </p>
              <Button
                disabled={isDeviceBusy}
                onClick={disableDevice}
                variant="outline"
              >
                <BellOff className="mr-2 h-4 w-4" />
                Turn off on this device
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-sm">
                Push notifications are off for this device.
              </p>
              <Button disabled={isDeviceBusy} onClick={enableDevice}>
                {isDeviceBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Bell className="mr-2 h-4 w-4" />
                )}
                Turn on for this device
              </Button>
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <Button disabled={isTesting} onClick={sendTest} variant="outline">
            {isTesting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Send test notification
          </Button>
        </div>
      </div>
    </Card>
  );
}
