-- Report scheduling: cron-driven report generation and distribution
CREATE TABLE IF NOT EXISTS reports.report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  report_name VARCHAR(256) NOT NULL,
  cron_expression VARCHAR(64) NOT NULL DEFAULT '0 8 * * 1',
  format VARCHAR(8) NOT NULL DEFAULT 'pdf' CHECK (format IN ('pdf','csv','xlsx')),
  recipients JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL
);
