-- 0021: AI/ML Plugin Registry — config, prediction logs, observability

-- Plugin configuration per tenant (enable/disable, threshold, mode)
CREATE TABLE IF NOT EXISTS hrms.ai_plugin_configs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  plugin_id TEXT NOT NULL, -- e.g. 'face-verification', 'attrition-prediction'
  enabled BOOLEAN NOT NULL DEFAULT false,
  mode TEXT NOT NULL DEFAULT 'disabled' CHECK (mode IN ('active', 'shadow', 'disabled')),
  confidence_threshold INT NOT NULL DEFAULT 50 CHECK (confidence_threshold BETWEEN 0 AND 100),
  notify_on_prediction BOOLEAN NOT NULL DEFAULT false,
  auto_action BOOLEAN NOT NULL DEFAULT false,
  max_predictions_per_day INT NOT NULL DEFAULT 1000,
  model_version TEXT, -- current deployed model version
  last_trained_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, plugin_id)
);

-- Prediction log — every ML prediction is logged for observability + feedback
CREATE TABLE IF NOT EXISTS hrms.ai_prediction_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  plugin_id TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0, -- 0-100
  latency_ms INT NOT NULL DEFAULT 0,
  input_summary TEXT, -- human-readable summary of input (no PII)
  output_summary TEXT, -- human-readable summary of prediction
  outcome TEXT CHECK (outcome IN ('correct', 'incorrect', 'unsure', 'pending')), -- human feedback
  feedback_notes TEXT,
  feedback_by UUID,
  feedback_at TIMESTAMPTZ,
  model_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_prediction_tenant ON hrms.ai_prediction_log (tenant_id, plugin_id, created_at DESC);
CREATE INDEX idx_ai_prediction_outcome ON hrms.ai_prediction_log (tenant_id, plugin_id, outcome) WHERE outcome IS NOT NULL;
