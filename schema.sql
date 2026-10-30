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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Where a punch happened, captured only when the org turns location on.
-- `*_site_name` is a snapshot of the matched site's name at punch time, so
-- renaming or removing a site never rewrites history.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_latitude DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_longitude DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_accuracy_m DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_site_name TEXT;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_latitude DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_longitude DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_accuracy_m DOUBLE PRECISION;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_out_site_name TEXT;

CREATE INDEX idx_time_entries_user_org ON time_entries (user_id, org_id);

CREATE INDEX IF NOT EXISTS idx_sites_org ON sites (org_id);
