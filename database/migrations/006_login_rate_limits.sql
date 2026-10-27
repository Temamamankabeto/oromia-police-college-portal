-- Login rate-limit counters.
-- The application will use HMAC-derived identifiers
-- rather than storing raw email addresses or IP addresses.

CREATE TABLE IF NOT EXISTS login_rate_limits (
    identifier VARCHAR(128) PRIMARY KEY,
    attempt_count INTEGER NOT NULL DEFAULT 0
        CHECK (attempt_count >= 0),
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    blocked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_rate_limits_blocked_until
    ON login_rate_limits (blocked_until);

CREATE INDEX IF NOT EXISTS idx_login_rate_limits_updated_at
    ON login_rate_limits (updated_at);
