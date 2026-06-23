-- Migration 0011: AI/ML Fraud Detection & HR Intelligence

-- ═══ Fraud Alerts Table ═══
CREATE TABLE IF NOT EXISTS employee.hrms_fraud_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  alert_type VARCHAR(64) NOT NULL CHECK (alert_type IN (
    'gps_spoofing', 'buddy_punch', 'impossible_time', 'device_anomaly',
    'ghost_employee', 'duplicate_bank', 'salary_anomaly', 'unpaid_attendance',
    'leave_pattern_abuse', 'monday_friday_pattern', 'sandwich_avoidance', 'approver_collusion',
    'attrition_risk', 'overtime_abuse', 'proxy_attendance', 'inactive_on_payroll'
  )),
  severity VARCHAR(12) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  employee_id UUID,
  description TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}',
  risk_score NUMERIC(5,4) NOT NULL DEFAULT 0,  -- 0.0000 to 1.0000
  ml_model VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'confirmed', 'dismissed', 'resolved')),
  assigned_to UUID,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_tenant ON employee.hrms_fraud_alerts(tenant_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_emp ON employee.hrms_fraud_alerts(tenant_id, employee_id);

-- ═══ ML Model Runs (audit trail of analysis jobs) ═══
CREATE TABLE IF NOT EXISTS employee.hrms_ml_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  model_name VARCHAR(64) NOT NULL,
  run_type VARCHAR(32) NOT NULL DEFAULT 'scheduled' CHECK (run_type IN ('scheduled', 'manual', 'realtime')),
  input_records INT NOT NULL DEFAULT 0,
  alerts_generated INT NOT NULL DEFAULT 0,
  duration_ms INT,
  status VARCHAR(16) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ═══ Employee Risk Scores (updated by ML pipeline) ═══
CREATE TABLE IF NOT EXISTS employee.hrms_employee_risk_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  overall_risk NUMERIC(5,4) NOT NULL DEFAULT 0,
  attendance_risk NUMERIC(5,4) NOT NULL DEFAULT 0,
  leave_risk NUMERIC(5,4) NOT NULL DEFAULT 0,
  payroll_risk NUMERIC(5,4) NOT NULL DEFAULT 0,
  attrition_risk NUMERIC(5,4) NOT NULL DEFAULT 0,
  last_computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  factors JSONB NOT NULL DEFAULT '[]',
  UNIQUE(tenant_id, employee_id)
);

-- ═══ HR Recommendations ═══
CREATE TABLE IF NOT EXISTS employee.hrms_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID,
  category VARCHAR(32) NOT NULL CHECK (category IN ('wellness', 'compliance', 'retention', 'performance', 'staffing', 'cost_optimization')),
  title VARCHAR(256) NOT NULL,
  description TEXT NOT NULL,
  priority VARCHAR(8) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  action_url VARCHAR(512),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  is_actioned BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

