-- 0044_certificate_public_verify_policy.sql
--
-- V4-G-01: the public QR verification route GET /v1/citizen/certificates/verify/:token is
-- anonymous, so the request carries no tenant and app.tenant_id is unset. issuance.certificates is
-- FORCE ROW LEVEL SECURITY (tenant_isolation: tenant_id = portal.current_tenant_id()), so the
-- token lookup always matched 0 rows and every QR scan answered 404.
--
-- Same reviewed, narrowly scoped cross-tenant read as hrms-service 0251 (visiting-card share
-- token): the public route sets the transaction-local GUC app.cert_verify_token to the PRESENTED
-- token and nothing else. This SELECT-only policy makes visible exactly the one certificate whose
-- verify_token equals that GUC. With the GUC unset (or empty) the policy is false, so nothing is
-- enumerable. No INSERT/UPDATE/DELETE bypass is added; writes stay governed by tenant_isolation.
-- It is OR-ed with the existing strict tenant policy (never replaces it). The route selects only
-- the non-PII attestation columns (cert no/type/status/validity/hash/signature/issued_at).
--
-- Additive + idempotent.
-- Rollback: DROP POLICY public_verify_read ON issuance.certificates;

SET lock_timeout = '5s';

DROP POLICY IF EXISTS public_verify_read ON issuance.certificates;
CREATE POLICY public_verify_read ON issuance.certificates
  FOR SELECT
  USING (verify_token IS NOT NULL
         AND verify_token = NULLIF(current_setting('app.cert_verify_token', true), ''));
