CREATE OR REPLACE FUNCTION opc_guard_proposal_edit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_module_id bigint;
  current_status text;
BEGIN
  IF TG_TABLE_NAME = 'institutional_modules' THEN
    target_module_id :=
      CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_module_id :=
      CASE WHEN TG_OP = 'DELETE'
        THEN OLD.module_id ELSE NEW.module_id END;

    IF TG_OP = 'UPDATE'
       AND NEW.module_id IS DISTINCT FROM OLD.module_id THEN
      RAISE EXCEPTION 'Activity cannot change its parent proposal'
        USING ERRCODE = '23514';
    END IF;

    -- Serialize activity changes with review transitions.
    PERFORM 1
    FROM institutional_modules
    WHERE id = target_module_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent proposal not found'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  SELECT approval_status
  INTO current_status
  FROM module_reviews
  WHERE module_id = target_module_id;

  IF COALESCE(current_status, 'PENDING')
     NOT IN ('PENDING', 'REVISION_REQUESTED') THEN
    RAISE EXCEPTION
      'Proposal % is locked in status %',
      target_module_id, current_status
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opc_module_edit_guard
ON institutional_modules;

CREATE TRIGGER opc_module_edit_guard
BEFORE UPDATE OR DELETE
ON institutional_modules
FOR EACH ROW
EXECUTE FUNCTION opc_guard_proposal_edit();

DROP TRIGGER IF EXISTS opc_activity_edit_guard
ON module_activities;

CREATE TRIGGER opc_activity_edit_guard
BEFORE INSERT OR UPDATE OR DELETE
ON module_activities
FOR EACH ROW
EXECUTE FUNCTION opc_guard_proposal_edit();
