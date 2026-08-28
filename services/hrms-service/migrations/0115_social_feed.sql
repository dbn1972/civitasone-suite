-- 0115: Social Feed — kudos, announcements, travel requests, expense claims, push devices
-- Part of world-class employee app feature set
--
-- FIX (see PR): every table below originally targeted a schema literally
-- named `hrms`. That schema does not exist and was never created by any
-- migration in this service — civitas_hrms has 29 real domain schemas
-- (employee, claims, medical, leave, disciplinary, ...) and this service's
-- actual, universal convention is <domain-schema>.hrms_<feature>, e.g.
-- claims.hrms_cea_claims, claims.hrms_ltc_claims, employee.hrms_salary_advances,
-- medical.hrms_medical_claims. `hrms.expense_claims` / `hrms.travel_requests`
-- matched nothing else in the codebase; every CREATE TABLE in this file was
-- guaranteed to fail with "schema \"hrms\" does not exist" the moment anyone
-- tried to apply it, which is why GET /v1/hrms/expenses and
-- GET /v1/hrms/travel-requests 500'd with "relation does not exist" and the
-- rest of this file's tables (kudos, announcements, push devices — all
-- actively queried by social/routes.ts) silently never worked either.
--
-- Retargeted, matching the shape/domain of each table:
--   hrms.travel_requests, hrms.expense_claims
--     -> claims.hrms_travel_requests, claims.hrms_expense_claims
--     (claims already holds two structurally identical employee
--     reimbursement-claim tables — hrms_cea_claims, hrms_ltc_claims — both
--     RLS-forced; same shape: employee submits, manager/HR approves/rejects)
--   hrms.social_kudos, hrms.social_kudos_reactions, hrms.social_announcements,
--   hrms.push_devices
--     -> employee.hrms_social_kudos, employee.hrms_social_kudos_reactions,
--        employee.hrms_social_announcements, employee.hrms_push_devices
--     (no dedicated social/engagement/comms schema exists anywhere in this
--     database; `employee` is this service's established home for general
--     employee-domain features that don't belong to a specialized process
--     schema — see hrms_documents, hrms_recommendations, hrms_salary_advances,
--     hrms_loans, hrms_fraud_alerts, hrms_audit_log)
--
-- All six tables get RLS ENABLE+FORCE with `tenant_isolation_policy` against
-- employee.current_tenant_id() — the dominant fleet-wide convention (91
-- existing tables use this exact policy name/expression, including sibling
-- claims.hrms_cea_claims and employee.hrms_documents). This migration never
-- successfully applied anywhere (a live information_schema check in the dev
-- DB, and the CREATE-TABLE-against-a-nonexistent-schema failure mode itself,
-- both confirm this), so there is no pre-existing unprotected data at stake.
--
-- Column sets are otherwise unchanged from the original file — they already
-- match what services/hrms-service/src/modules/social/routes.ts queries.

-- Peer Recognition (Kudos)
CREATE SCHEMA IF NOT EXISTS employee;

CREATE TABLE IF NOT EXISTS employee.hrms_social_kudos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  giver_id UUID NOT NULL,
  receiver_id UUID NOT NULL,
  giver_name TEXT NOT NULL,
  receiver_name TEXT NOT NULL,
  badge TEXT NOT NULL DEFAULT 'star',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kudos_tenant_created ON employee.hrms_social_kudos (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kudos_receiver ON employee.hrms_social_kudos (tenant_id, receiver_id);
ALTER TABLE employee.hrms_social_kudos ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_social_kudos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_social_kudos;
CREATE POLICY tenant_isolation_policy ON employee.hrms_social_kudos
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- Kudos reactions (likes). No tenant_id column in the original design (the
-- FK to hrms_social_kudos already scopes each reaction to a tenant
-- transitively), so RLS is enforced through the parent row instead of a
-- local column. Nothing in social/routes.ts writes to this table yet (no
-- "react" endpoint exists) — only read via a COUNT(*) subquery in the kudos
-- feed — so this is currently a read-only, forward-looking table.
CREATE TABLE IF NOT EXISTS employee.hrms_social_kudos_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kudos_id UUID NOT NULL REFERENCES employee.hrms_social_kudos(id),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kudos_id, user_id)
);
ALTER TABLE employee.hrms_social_kudos_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_social_kudos_reactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_social_kudos_reactions;
CREATE POLICY tenant_isolation_policy ON employee.hrms_social_kudos_reactions
  USING (EXISTS (
    SELECT 1 FROM employee.hrms_social_kudos k
    WHERE k.id = kudos_id AND k.tenant_id = employee.current_tenant_id()
  ));

-- Announcements
CREATE TABLE IF NOT EXISTS employee.hrms_social_announcements (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_announcements_tenant ON employee.hrms_social_announcements (tenant_id, pinned DESC, created_at DESC);
ALTER TABLE employee.hrms_social_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_social_announcements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_social_announcements;
CREATE POLICY tenant_isolation_policy ON employee.hrms_social_announcements
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- Travel Requests
CREATE SCHEMA IF NOT EXISTS claims;

CREATE TABLE IF NOT EXISTS claims.hrms_travel_requests (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  purpose TEXT NOT NULL,
  destination TEXT NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  advance_required BIGINT NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'rail',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_travel_tenant_employee ON claims.hrms_travel_requests (tenant_id, employee_id, created_at DESC);
ALTER TABLE claims.hrms_travel_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims.hrms_travel_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON claims.hrms_travel_requests;
CREATE POLICY tenant_isolation_policy ON claims.hrms_travel_requests
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- Expense Claims
CREATE TABLE IF NOT EXISTS claims.hrms_expense_claims (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  category TEXT NOT NULL,
  amount BIGINT NOT NULL, -- paise
  description TEXT NOT NULL DEFAULT '',
  expense_date DATE NOT NULL,
  receipt_key TEXT,
  travel_request_id UUID REFERENCES claims.hrms_travel_requests(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_employee ON claims.hrms_expense_claims (tenant_id, employee_id, created_at DESC);
ALTER TABLE claims.hrms_expense_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims.hrms_expense_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON claims.hrms_expense_claims;
CREATE POLICY tenant_isolation_policy ON claims.hrms_expense_claims
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- Push Notification Device Tokens
CREATE TABLE IF NOT EXISTS employee.hrms_push_devices (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_push_devices_user ON employee.hrms_push_devices (tenant_id, user_id);
ALTER TABLE employee.hrms_push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_push_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_push_devices;
CREATE POLICY tenant_isolation_policy ON employee.hrms_push_devices
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());
