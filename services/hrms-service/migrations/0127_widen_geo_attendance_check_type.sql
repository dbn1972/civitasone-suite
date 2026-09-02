-- Migration 0127: widen attendance.hrms_geo_attendance.check_type
--
-- Root cause: migration 0007_geo_attendance_ro.sql declared check_type as
-- VARCHAR(8) NOT NULL CHECK (check_type IN ('check_in', 'check_out')).
-- "check_in" is exactly 8 characters and fits, but "check_out" is 9
-- characters and does not — every check-out write fails at the database
-- layer with 22001 "value too long for type character varying(8)"
-- (see modules/geo-attendance/f3-consumer.ts, geo_attendance_routes__2,
-- which documents this as a known blocker not fixable from that file).
-- Migration 0039_additional_status_type_constraints.sql reviewed this same
-- column and concluded "SKIPPED, already covered" — that note only checked
-- that the CHECK constraint's allowed value list was correct, not that the
-- column was wide enough to hold every value in that list.
--
-- The CHECK constraint (hrms_geo_attendance_check_type_check, from 0007)
-- already permits exactly {'check_in','check_out'} and needs no change —
-- only the column length was wrong. VARCHAR(16) comfortably fits both
-- current values plus headroom for any future check_type values of similar
-- shape (e.g. "check_break_in"/"check_break_out" style additions).
--
-- Idempotent: safe to re-run — ALTER COLUMN ... TYPE varchar(16) is a no-op
-- once the column is already varchar(16) or wider (widening never fails on
-- a varchar with an equal-or-shorter existing length).

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE attendance.hrms_geo_attendance
  ALTER COLUMN check_type TYPE varchar(16);

COMMIT;
