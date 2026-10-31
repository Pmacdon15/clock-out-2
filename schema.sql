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
