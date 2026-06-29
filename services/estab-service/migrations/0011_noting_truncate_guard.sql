-- estab-service TRUNCATE guard (Platform Review R3 / S3).
-- 0007's enforce_noting_immutability is BEFORE UPDATE OR DELETE FOR EACH ROW and
-- does not fire on TRUNCATE; GRANT ALL hands estab_svc TRUNCATE. This closes the
-- bypass so the tamper-evident green-note hash chain cannot be wiped.

CREATE OR REPLACE FUNCTION files.reject_noting_truncate()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'files.estab_notings is immutable: TRUNCATE is not permitted (R3)'
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_noting_no_truncate ON files.estab_notings;
CREATE TRIGGER trg_noting_no_truncate
  BEFORE TRUNCATE ON files.estab_notings
  FOR EACH STATEMENT
  EXECUTE FUNCTION files.reject_noting_truncate();

REVOKE TRUNCATE, TRIGGER ON files.estab_notings FROM estab_svc;

-- The module decision log is also evidentiary — guard it too (only if present;
-- it is created by 0007, which may not be applied in every environment yet).
DO $$
BEGIN
  IF to_regclass('files.module_decision_log') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_decision_log_no_truncate ON files.module_decision_log;
    CREATE TRIGGER trg_decision_log_no_truncate
      BEFORE TRUNCATE ON files.module_decision_log
      FOR EACH STATEMENT
      EXECUTE FUNCTION files.reject_noting_truncate();
    REVOKE TRUNCATE, TRIGGER ON files.module_decision_log FROM estab_svc;
  END IF;
END $$;
