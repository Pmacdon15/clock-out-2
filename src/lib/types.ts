export type TimeEntry = {
  id: number;
  user_id: string;
  org_id: string;
  clock_in: Date;
  clock_out: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type SerializableResult<T, E> =
  | { value: T; ok: true }
  | { error: E; ok: false };

export type ReportingSettingsData = {
  org_id: string;
  report_frequency: string;
  report_day: string | null;
  report_interval: number;
  updated_at?: Date;
};

export type OrgSettingsData = {
  org_id: string;
  updated_at?: Date;
  reporting?: ReportingSettingsData;
};

export interface DashboardTabsProps {
  defaultTabPromise: Promise<string | undefined>;
  entriesPromise: Promise<SerializableResult<TimeEntry[], { reason: string }>>;
  orgSettingsPromise: Promise<
    SerializableResult<
      ReportingSettingsData | null,
      {
        reason: string;
      }
    >
  >;
  orgTimeEntriesPromise: Promise<
    SerializableResult<TimeEntry[], { reason: string }>
  >;
  recentEntriesPromise: Promise<
    SerializableResult<TimeEntry[], { reason: string }>
  >;
  membersPromise?: Promise<
    {
      id: string;
      name: string;
    }[]
  >;
  selectedUserIdPromise?: Promise<string | undefined>;
  selectedWeekPromise?: Promise<string | undefined>;
  selectedMonthPromise?: Promise<string | undefined>;
  selectedYearPromise?: Promise<string | undefined>;
  timeframePromise?: Promise<string | undefined>;
  endDatePromise: Promise<string | undefined>;
  startDatePromise: Promise<string | undefined>;
  isAdminPromise: Promise<boolean>;
  hasReportingPromise: Promise<boolean>;
  userIdPromise: Promise<string | undefined>;
  orgIdPromise: Promise<string | undefined>;
}
export interface ViewHoursProps {
  entries: TimeEntry[];
  setOptimisticEntries: (action: {
    type: "ADD" | "REMOVE" | "UPDATE";
    payload: any;
  }) => void;
  isAdmin?: boolean;
  membersPromise?: Promise<
    {
      id: string;
      name: string;
    }[]
  >;
  orgTimeEntriesPromise: Promise<
    SerializableResult<TimeEntry[], { reason: string }>
  >;
  selectedUserIdPromise?: Promise<string | undefined>;
  selectedWeekPromise?: Promise<string | undefined>;
  selectedMonthPromise?: Promise<string | undefined>;
  selectedYearPromise?: Promise<string | undefined>;
  timeframePromise?: Promise<string | undefined>;
  startDatePromise?: Promise<string | undefined>;
  endDatePromise?: Promise<string | undefined>;
  currentUserIdPromise?: Promise<string | null | undefined>;
}
