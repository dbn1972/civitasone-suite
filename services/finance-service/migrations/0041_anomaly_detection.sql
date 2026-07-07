-- Migration: 0041_anomaly_detection.sql
-- Purpose: Add finance_anomalies table for ML-driven anomaly detection.
-- Rollback: DROP TABLE IF EXISTS finance_anomalies;
-- Affected services: finance-service (anomaly module)
-- Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS finance_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  transaction_id UUID NOT NULL,
  anomaly_type TEXT NOT NULL CHECK (anomaly_type IN ('zscore', 'duplicate', 'cost_center_pattern', 'user_behavior')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  z_score NUMERIC(8, 4),
  factors JSONB NOT NULL DEFAULT '[]',
  vendor_id TEXT,
  category_id TEXT,
  amount_paise TEXT,
  dismissed_by UUID,
  dismiss_reason TEXT,
  dismissed_at TIMESTAMPTZ,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1
);

-- Indexes (CONCURRENTLY for non-blocking creation on live tables)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_anomalies_tenant_status
  ON finance_anomalies (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_anomalies_transaction
  ON finance_anomalies (tenant_id, transaction_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_anomalies_created_at
  ON finance_anomalies (created_at DESC);

-- RLS policy for tenant isolation
ALTER TABLE finance_anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY finance_anomalies_tenant_isolation ON finance_anomalies
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
