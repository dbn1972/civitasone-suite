-- 0159_hrms_employees_share_birthday.sql
-- GAP-HR-SOCIAL-FEED-01: GET /v1/hrms/social/feed's "today's birthdays"
-- block listed any employee whose date_of_birth matched today (full name,
-- department, designation) to every authenticated HR/manager/employee
-- caller tenant-wide, with no consent flag or opt-out at all -- a DPDP
-- concern for a government workforce, flagged in the HR gap decision
-- packet (theme 2, "DPDP & who sees what").
--
-- Decision packet's recommended default (applied here): "Add an opt-in
-- flag, default off; only show birthdays for employees who've actively
-- opted in." This column is that flag. It defaults to false, so this
-- migration itself does not expose anyone -- the feed's WHERE clause
-- (services/hrms-service/src/modules/social/routes.ts) now requires
-- share_birthday = true in addition to the date match. There is not yet a
-- self-service UI for an employee to set this to true; that is a separate,
-- larger piece of work (a real settings surface, not a mechanical fix) --
-- flagged for human/product follow-up rather than built unreviewed here.
--
-- ADD COLUMN ... NOT NULL DEFAULT is a metadata-only change on PG11+ (the
-- default is stored in the catalog, not backfilled row-by-row) -- no table
-- rewrite, no long lock, same posture as migration 0147/0151's ADD COLUMN.
-- No per-tenant backfill loop is needed (unlike migration 0151's
-- classification backfill): every existing row correctly becomes `false`
-- via the column default alone, which is exactly the safe, no-consent-yet
-- state this fix requires.
--
-- Renumbered from 0158 -> 0159: 0158 was independently claimed by two OTHER
-- open PRs at the time this was written (#1698 salary_advance_reject,
-- #1704 hrms_probation_extensions) -- a 3-way collision, not caught before
-- initial push because each lane only checked origin/main + its own prior
-- gh pr list snapshot, not every other lane's claim at push time in a
-- fast-moving multi-agent campaign. Verified against a fresh gh pr list
-- (all open PRs' actual claimed migration files) before picking 0159.
--
-- Rollback:
--   ALTER TABLE employee.hrms_employees DROP COLUMN IF EXISTS share_birthday;
-- Affected services: hrms-service only (apps/web reads this indirectly,
-- through the /social/feed response, not this column directly).

SET lock_timeout = '5s';

ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS share_birthday BOOLEAN NOT NULL DEFAULT false;
