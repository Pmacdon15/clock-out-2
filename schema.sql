-- schema.sql
CREATE TABLE IF NOT EXISTS time_entries (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    org_id VARCHAR(255) NOT NULL,
    clock_in TIMESTAMP WITH TIME ZONE NOT NULL,
    clock_out TIMESTAMP WITH TIME ZONE,
    skip_lunch BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    org_id TEXT PRIMARY KEY,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reporting_settings (
    org_id TEXT PRIMARY KEY REFERENCES settings(org_id) ON DELETE CASCADE,
    report_frequency TEXT NOT NULL DEFAULT 'weekly',
    report_day TEXT, -- e.g., 'Monday', 'Tuesday'
    report_interval INTEGER DEFAULT 1, -- 1 for weekly, 2 for bi-weekly
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS break_settings (
    org_id TEXT PRIMARY KEY REFERENCES settings(org_id) ON DELETE CASCADE,
    dock_lunch BOOLEAN NOT NULL DEFAULT FALSE,
    lunch_duration_minutes INTEGER NOT NULL DEFAULT 30,
    lunch_min_shift_hours DOUBLE PRECISION NOT NULL DEFAULT 5,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
-- Longest each kind of break may run, in minutes. NULL = no limit. A break
-- that reaches its limit is closed at break_start + limit (the member is put
-- back on the clock automatically).
ALTER TABLE break_settings ADD COLUMN IF NOT EXISTS max_meal_break_minutes INTEGER;
ALTER TABLE break_settings ADD COLUMN IF NOT EXISTS max_unpaid_rest_break_minutes INTEGER;
ALTER TABLE break_settings ADD COLUMN IF NOT EXISTS max_paid_break_minutes INTEGER;

-- Overtime thresholds in hours. NULL turns that threshold off. Daily
-- overtime is hours past the daily threshold on one day; weekly overtime is
-- the remaining hours past the weekly threshold in a Monday-Sunday week.
CREATE TABLE IF NOT EXISTS overtime_settings (
    org_id TEXT PRIMARY KEY REFERENCES settings(org_id) ON DELETE CASCADE,
    daily_threshold_hours DOUBLE PRECISION,
    weekly_threshold_hours DOUBLE PRECISION,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Each member's hourly rate and overtime multiplier, for estimated gross
-- pay: regular hours x rate + overtime hours x rate x multiplier. No row
-- means no rate (pay isn't estimated for that member).
CREATE TABLE IF NOT EXISTS member_pay_rates (
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    hourly_rate DOUBLE PRECISION NOT NULL,
    overtime_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS location_settings (
    org_id TEXT PRIMARY KEY REFERENCES settings(org_id) ON DELETE CASCADE,
    -- 'off' | 'optional' | 'required'
    capture_mode TEXT NOT NULL DEFAULT 'off',
    restrict_clock_in BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sites (
    id SERIAL PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES settings(org_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    radius_meters DOUBLE PRECISION NOT NULL DEFAULT 150,
    address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS address TEXT;

-- Where a punch happened, captured only when the org turns location on.
-- `*_site_name` is a snapshot of the matched site's name at punch time, so
-- renaming or removing a site never rewrites history.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS skip_lunch BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_latitude DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_longitude DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_accuracy_m DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_site_name TEXT;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_address TEXT;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_latitude DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_longitude DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_accuracy_m DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_site_name TEXT;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_address TEXT;

CREATE INDEX idx_time_entries_user_org ON time_entries (user_id, org_id);

-- Break / meal-period records for a single shift. `break_type` distinguishes
-- paid breaks (recorded only) from unpaid ones (subtracted from worked hours);
-- 'unpaid_meal' is the jurisdictional meal period.
CREATE TABLE IF NOT EXISTS time_entry_breaks (
    id SERIAL PRIMARY KEY,
    time_entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
    break_type TEXT NOT NULL DEFAULT 'unpaid_meal'
        CHECK (break_type IN ('unpaid_meal', 'unpaid_rest', 'paid_rest')),
    break_start TIMESTAMP WITH TIME ZONE NOT NULL,
    -- NULL while the break is still running.
    break_end TIMESTAMP WITH TIME ZONE,
    CHECK (break_end IS NULL OR break_end > break_start),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_time_entry_breaks_entry
    ON time_entry_breaks (time_entry_id, break_start);

-- At most one running break per entry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entry_breaks_one_open
    ON time_entry_breaks (time_entry_id)
    WHERE break_end IS NULL;
CREATE INDEX IF NOT EXISTS idx_sites_org ON sites (org_id);

-- Shift alerts: per-org rules for "forgot to clock out" / "forgot to end
-- break" reminders and automatic clock-out. Every rule is off by default.
CREATE TABLE IF NOT EXISTS alert_settings (
    org_id TEXT PRIMARY KEY REFERENCES settings(org_id) ON DELETE CASCADE,
    forgot_clock_out_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    forgot_clock_out_hours DOUBLE PRECISION NOT NULL DEFAULT 10,
    auto_clock_out_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    auto_clock_out_hours DOUBLE PRECISION NOT NULL DEFAULT 16,
    break_reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    break_reminder_minutes INTEGER NOT NULL DEFAULT 45,
    notify_admins BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- How each person wants alerts delivered (email, push or both), per topic.
CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id TEXT PRIMARY KEY,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    shift_alerts BOOLEAN NOT NULL DEFAULT TRUE,
    break_alerts BOOLEAN NOT NULL DEFAULT TRUE,
    admin_alerts BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- One row per browser/device that turned on Web Push.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);

-- Every alert sent, keyed e.g. 'forgot:<entry id>' or 'break:<break id>', so
-- each alert goes out once however often the cron runs.
CREATE TABLE IF NOT EXISTS sent_alerts (
    alert_key TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Shifts an admin publishes for a member. Compared with time_entries to flag
-- late arrivals and no-shows; nothing here changes worked hours.
CREATE TABLE IF NOT EXISTS scheduled_shifts (
    id SERIAL PRIMARY KEY,
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    shift_start TIMESTAMP WITH TIME ZONE NOT NULL,
    shift_end TIMESTAMP WITH TIME ZONE NOT NULL,
    note TEXT,
    created_by TEXT NOT NULL,
    CHECK (shift_end > shift_start),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_shifts_org_start
    ON scheduled_shifts (org_id, shift_start);

-- Paid time off requested by members and approved by admins. Dates are
-- whole calendar days (inclusive). Approved time off is shown alongside
-- worked hours; it never creates or changes time_entries.
CREATE TABLE IF NOT EXISTS time_off_requests (
    id SERIAL PRIMARY KEY,
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    request_type TEXT NOT NULL CHECK (request_type IN ('vacation', 'sick', 'unpaid')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    hours_per_day DOUBLE PRECISION NOT NULL DEFAULT 8,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
    reviewed_by TEXT,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    CHECK (end_date >= start_date),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_off_requests_org_dates
    ON time_off_requests (org_id, end_date);

-- PTO (vacation) days each member gets per calendar year. No row = no limit.
CREATE TABLE IF NOT EXISTS time_off_allowances (
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    pto_days DOUBLE PRECISION NOT NULL CHECK (pto_days >= 0),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (org_id, user_id)
);
