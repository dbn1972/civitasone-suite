-- 0143_service_book_audit_columns.sql
-- SEC-CRIT-002: hrms_service_book_entries had no updated_at/updated_by --
-- only created_at/recorded_by on the original write, so an edited entry
-- left no trace of who last touched it or when.
-- Additive, backward compatible: nullable, no default -- existing rows and
-- rows that have never been edited simply read NULL here. Populated by the
-- service-book edit consumer (f3-consumer.ts, service_book_routes__1).
ALTER TABLE lifecycle.hrms_service_book_entries ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE lifecycle.hrms_service_book_entries ADD COLUMN IF NOT EXISTS updated_by uuid;
