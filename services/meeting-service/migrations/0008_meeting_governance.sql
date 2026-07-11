-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0008_meeting_governance.sql
-- Service:   meeting-service (gateway /api/v1/meetings) — DB civitas_meeting
--
-- Purpose:
--   Closes the statutory/product-completeness gaps flagged in the governance review:
--     1. Recusal / conflict-of-interest — NEW table `meeting.recusals`: a member
--        declares/records a recusal on a specific motion (resolution). A recused
--        member cannot cast a vote on that motion, is excluded from its tally and
--        from the quorum-for-that-item denominator, and the recusal is recorded for
--        the vote record / minutes (with an optional register-of-interests link).
--     2. Weighted voting — per-member vote weight on `committee_members.vote_weight`
--        (e.g. board shareholding / ex-officio weighting) captured onto each ballot
--        (`votes.weight`) so a weighted tally can be summed without re-joining, plus
--        weighted position sums on `resolutions.weight_for/_against/_abstain`
--        (populated only when the Wave-config `voting.weighted_enabled` toggle is on).
--     3. Notice-period enforcement — `meetings.short_notice_waived` + `notice_days`
--        record whether a meeting was convened with less than the configured minimum
--        notice and, if so, that a waiver was explicitly recorded.
--
--   ADDITIVE + IDEMPOTENT: every column/table/index is created with IF NOT EXISTS
--   (or ADD COLUMN IF NOT EXISTS) so the migration can be re-applied safely. All new
--   columns carry behavior-preserving defaults (weight = 1, waiver = false), so a
--   tenant that configures nothing sees IDENTICAL behavior (1 member = 1 vote).
--
-- Row-level security (RLS) — the new `meeting.recusals` table follows the service
--   standard (mirrors 0005/0006): ENABLE + FORCE ROW LEVEL SECURITY with the
--   fail-closed missing-ok GUC policy, so even the owner role is tenant-scoped and an
--   UNSET GUC yields NULL (rows invisible). The BYPASSRLS `meeting_scanner` role is
--   granted SELECT for any cross-tenant maintenance read.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval):
--   DROP TABLE IF EXISTS meeting.recusals;
--   ALTER TABLE meeting.committee_members DROP COLUMN IF EXISTS vote_weight;
--   ALTER TABLE meeting.votes             DROP COLUMN IF EXISTS weight;
--   ALTER TABLE meeting.resolutions       DROP COLUMN IF EXISTS weight_for,
--     DROP COLUMN IF EXISTS weight_against, DROP COLUMN IF EXISTS weight_abstain;
--   ALTER TABLE meeting.meetings          DROP COLUMN IF EXISTS short_notice_waived,
--     DROP COLUMN IF EXISTS notice_days;
--
-- Affected services: meeting-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. RECUSAL / CONFLICT-OF-INTEREST
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS meeting.recusals (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    resolution_id  UUID NOT NULL,
    meeting_id     UUID NOT NULL,
    member_id      UUID NOT NULL,
    agenda_item_id UUID,
    reason         TEXT NOT NULL,
    register_ref   TEXT,
    recorded_by    UUID NOT NULL,
    recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One recusal per (resolution, member): a member is either recused on a motion or not.
CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_recusal_resolution_member
    ON meeting.recusals(tenant_id, resolution_id, member_id);

-- Read path: "who is recused on this motion" (tally / quorum-denominator exclusion).
CREATE INDEX IF NOT EXISTS idx_meeting_recusal_resolution
    ON meeting.recusals(tenant_id, resolution_id);

ALTER TABLE meeting.recusals ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.recusals FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recusals_tenant ON meeting.recusals;
CREATE POLICY recusals_tenant ON meeting.recusals
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meeting_scanner') THEN
    GRANT SELECT ON meeting.recusals TO meeting_scanner;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. WEIGHTED VOTING
-- ═══════════════════════════════════════════════════════════════════════════════

-- Per-member/per-seat vote weight (board shareholding, ex-officio weighting). Default
-- 1 → headcount behavior is unchanged when weighting is disabled or unset.
ALTER TABLE meeting.committee_members
    ADD COLUMN IF NOT EXISTS vote_weight INTEGER NOT NULL DEFAULT 1;

-- The weight applied to a single ballot, captured at cast time from the member's
-- committee vote_weight so the weighted tally sums without re-joining the roster.
ALTER TABLE meeting.votes
    ADD COLUMN IF NOT EXISTS weight INTEGER NOT NULL DEFAULT 1;

-- Weighted position sums, populated on conclude ONLY when voting.weighted_enabled is
-- on (NULL otherwise). Headcount votes_for/_against/_abstain remain authoritative for
-- display and the P14 count invariant regardless of weighting.
ALTER TABLE meeting.resolutions
    ADD COLUMN IF NOT EXISTS weight_for     INTEGER,
    ADD COLUMN IF NOT EXISTS weight_against INTEGER,
    ADD COLUMN IF NOT EXISTS weight_abstain INTEGER;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. NOTICE-PERIOD ENFORCEMENT
-- ═══════════════════════════════════════════════════════════════════════════════

-- Whether the meeting was convened with less than the configured minimum notice AND a
-- waiver was explicitly recorded (short notice — requires waiver). notice_days records
-- the actual notice (whole days between scheduling and the scheduled start) for audit.
ALTER TABLE meeting.meetings
    ADD COLUMN IF NOT EXISTS short_notice_waived BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS notice_days         INTEGER;
