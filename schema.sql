-- schema.sql
CREATE TABLE IF NOT EXISTS time_entries (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    org_id VARCHAR(255) NOT NULL,
    clock_in TIMESTAMP WITH TIME ZONE NOT NULL,
    clock_out TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


DROP TABLE IF EXISTS org_settings;

CREATE TABLE org_settings (
    org_id TEXT PRIMARY KEY,
    report_frequency TEXT NOT NULL DEFAULT 'weekly',
    report_day TEXT, -- e.g., 'Monday', 'Tuesday'
    report_interval INTEGER DEFAULT 1, -- 1 for weekly, 2 for bi-weekly
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_time_entries_user_org ON time_entries (user_id, org_id);
