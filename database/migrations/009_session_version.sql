ALTER TABLE app_users
ADD COLUMN IF NOT EXISTS session_version integer
NOT NULL DEFAULT 1;

ALTER TABLE app_users
ADD CONSTRAINT app_users_session_version_positive
CHECK (session_version >= 1);
