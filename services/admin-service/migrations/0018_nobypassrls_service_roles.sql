-- Migration: 0018_nobypassrls_service_roles.sql
-- Purpose: P0 Security — Remove BYPASSRLS from 9 service roles that should rely on RLS.
-- Scanner roles (meeting_scanner, visitor_scanner) intentionally keep BYPASSRLS for cross-tenant sweeper work.
-- Rollback: ALTER ROLE asset_svc BYPASSRLS; (etc.) — but DO NOT roll back in production.

ALTER ROLE asset_svc NOBYPASSRLS;
ALTER ROLE billing_svc NOBYPASSRLS;
ALTER ROLE citizen_svc NOBYPASSRLS;
ALTER ROLE helpdesk_svc NOBYPASSRLS;
ALTER ROLE notification_svc NOBYPASSRLS;
ALTER ROLE policy_svc NOBYPASSRLS;
ALTER ROLE project_svc NOBYPASSRLS;
ALTER ROLE report_svc NOBYPASSRLS;
ALTER ROLE workflow_svc NOBYPASSRLS;
