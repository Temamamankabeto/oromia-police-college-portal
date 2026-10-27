-- Oromia Police College Proposal Portal
-- PostgreSQL initial schema
-- Version: 001

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
