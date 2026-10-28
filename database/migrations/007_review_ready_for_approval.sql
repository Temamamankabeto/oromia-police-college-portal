-- Add explicit handoff state between review and approval.
-- Existing records and statuses remain unchanged.

ALTER TABLE module_reviews
DROP CONSTRAINT IF EXISTS module_reviews_approval_status_check;

ALTER TABLE module_reviews
DROP CONSTRAINT IF EXISTS chk_review_approval_status;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'module_reviews'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%approval_status%'
  LOOP
    EXECUTE format(
      'ALTER TABLE module_reviews DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END $$;

ALTER TABLE module_reviews
ADD CONSTRAINT chk_review_approval_status
CHECK (
  approval_status IN (
    'PENDING',
    'UNDER_REVIEW',
    'READY_FOR_APPROVAL',
    'APPROVED',
    'REVISION_REQUESTED',
    'REJECTED'
  )
);
