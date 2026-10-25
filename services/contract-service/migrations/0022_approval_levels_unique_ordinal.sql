-- 0022_approval_levels_unique_ordinal.sql
-- CLOS3-S4-04: approvals.contract_approval_levels had no uniqueness on (tenant_id, ordinal), so
-- concurrent creates (ordinal chosen by the route from a stale count) produced duplicate ordinals
-- and more than the 5-level maximum. The consumer now serialises creates per tenant and allocates
-- max(ordinal)+1; this index is the database-level guarantee behind it.
-- Existing duplicates (if any) are renumbered 1..n per tenant (ordered by ordinal, created_at, id)
-- before the index is built. DML on a FORCE-RLS table from an owner-run migration needs the
-- NO FORCE / FORCE wrap (no app.tenant_id GUC here); FORCE is restored unconditionally.
-- Idempotent. Rollback: DROP INDEX IF EXISTS approvals.uq_contract_approval_levels_tenant_ordinal;
-- (renumbered ordinals are not restored; they only encode order).
-- Affected services: contract-service

SET lock_timeout = '5s';

ALTER TABLE approvals.contract_approval_levels NO FORCE ROW LEVEL SECURITY;

UPDATE approvals.contract_approval_levels l
   SET ordinal = r.rn
  FROM (
    SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY ordinal, created_at, id) AS rn
      FROM approvals.contract_approval_levels
     WHERE tenant_id IN (
       SELECT tenant_id FROM approvals.contract_approval_levels GROUP BY tenant_id, ordinal HAVING count(*) > 1
     )
  ) r
 WHERE l.id = r.id AND l.ordinal <> r.rn;

ALTER TABLE approvals.contract_approval_levels FORCE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_approval_levels_tenant_ordinal
  ON approvals.contract_approval_levels (tenant_id, ordinal);
