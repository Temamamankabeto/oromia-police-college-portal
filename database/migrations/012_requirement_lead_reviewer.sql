-- OPC Portal: Requirement Lead Reviewer
-- Additive PostgreSQL 13+ migration.
-- Preserve existing assignments and revocation history.

ALTER TABLE requirement_assignments
ADD COLUMN is_lead BOOLEAN NOT NULL DEFAULT FALSE;

-- Only REVIEWER assignments may be designated as lead.
ALTER TABLE requirement_assignments
ADD CONSTRAINT chk_requirement_lead_reviewer_role
CHECK (
    is_lead = FALSE
    OR role_code = 'REVIEWER'
);

-- A revoked assignment cannot remain the active lead.
ALTER TABLE requirement_assignments
ADD CONSTRAINT chk_requirement_active_lead
CHECK (
    is_lead = FALSE
    OR revoked_at IS NULL
);

-- Enforce one active Lead Reviewer per requirement.
CREATE UNIQUE INDEX uq_requirement_active_lead_reviewer
ON requirement_assignments(requirement_id)
WHERE is_lead = TRUE
  AND revoked_at IS NULL;

COMMENT ON COLUMN requirement_assignments.is_lead IS
'Identifies the single active Lead Reviewer authorized to finalize requirement review.';