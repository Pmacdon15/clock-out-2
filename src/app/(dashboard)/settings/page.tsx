import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsFallback } from "@/components/fallbacks/settings-fallback";
import OrgSettings from "@/components/OrgSettings";
import { Card } from "@/components/ui";
import { getOrgAlertSettings } from "@/lib/alerts-dal";
import { NOTIFICATIONS_FEATURE } from "@/lib/billing";
import {
  getOrgBreakSettings,
  getOrgLocationSettings,
  getOrgMembers,
  getOrgOvertimeSettings,
  getOrgPayPeriodSettings,
  getOrgPayRates,
  getOrgReportingSettings,
  getOrgSites,
} from "@/lib/dal";
import { getOrgPayroll } from "@/lib/payroll-dal";
import { GEOFENCING_FEATURE, REPORTING_FEATURE } from "@/lib/plan-features";
import { hasFeature, isAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Settings | Clock Out" };

export default function SettingsPage() {
  return (
    <>
      <h2 className="sr-only">Settings</h2>
      <Suspense fallback={<SettingsFallback />}>{settingsPanel()}</Suspense>
    </>
  );
}

/** Only admins get the settings, and only theirs are read. */
async function settingsPanel() {
  if (!(await isAdmin())) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        Only organization admins can change settings.
      </Card>
    );
  }

  const [hasGeofencing, hasNotifications, hasReporting, payRates, payroll] =
    await Promise.all([
      hasFeature(GEOFENCING_FEATURE),
      hasFeature(NOTIFICATIONS_FEATURE),
      hasFeature(REPORTING_FEATURE),
      getOrgPayRates(),
      getOrgPayroll(),
    ]);

  return (
    <OrgSettings
      alertSettingsPromise={getOrgAlertSettings()}
      breakSettingsPromise={getOrgBreakSettings()}
      hasGeofencing={hasGeofencing}
      hasNotifications={hasNotifications}
      hasReporting={hasReporting}
      locationSettingsPromise={getOrgLocationSettings()}
      membersPromise={getOrgMembers()}
      orgSettingsPromise={getOrgReportingSettings()}
      overtimeSettingsPromise={getOrgOvertimeSettings()}
      payPeriodSettingsPromise={getOrgPayPeriodSettings()}
      payRates={payRates.ok ? payRates.value : []}
      payroll={payroll.ok ? payroll.value : null}
      sitesPromise={getOrgSites()}
    />
  );
}
