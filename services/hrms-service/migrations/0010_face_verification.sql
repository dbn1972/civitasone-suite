-- Migration 0010: Face Verification for Attendance
-- Pipeline: ONNX (local, <75% confidence) → AWS Rekognition (fallback)

-- ═══ Employee Profile Photos (reference face for matching) ═══
CREATE TABLE IF NOT EXISTS employee.hrms_profile_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  photo_key VARCHAR(1024) NOT NULL,        -- S3 object key
  photo_bucket VARCHAR(256) NOT NULL DEFAULT 'civitasone-photos',
  face_embedding BYTEA,                     -- ONNX-extracted 512-dim face vector (stored for fast local matching)
  embedding_model VARCHAR(64) DEFAULT 'arcface_mobilenet',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(tenant_id, employee_id)
);

-- ═══ Face Verification Log (every attendance check is logged) ═══
CREATE TABLE IF NOT EXISTS attendance.hrms_face_verification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  geo_attendance_id UUID,
  selfie_key VARCHAR(1024) NOT NULL,
  profile_photo_key VARCHAR(1024) NOT NULL,
  verification_method VARCHAR(16) NOT NULL CHECK (verification_method IN ('onnx', 'rekognition', 'manual', 'bypassed')),
  similarity_score NUMERIC(5,4),             -- 0.0000 to 1.0000
  confidence_threshold NUMERIC(5,4) NOT NULL DEFAULT 0.7500,
  is_match BOOLEAN NOT NULL,
  rekognition_used BOOLEAN NOT NULL DEFAULT FALSE,
  onnx_score NUMERIC(5,4),
  rekognition_score NUMERIC(5,4),
  processing_ms INT,
  failure_reason TEXT,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_face_log_emp ON attendance.hrms_face_verification_log(tenant_id, employee_id, verified_at DESC);

-- ═══ Face Verification Config (per tenant) ═══
CREATE TABLE IF NOT EXISTS attendance.hrms_face_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE,
  onnx_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  onnx_model_path VARCHAR(512) DEFAULT '/models/arcface_mobilenet.onnx',
  onnx_threshold NUMERIC(5,4) NOT NULL DEFAULT 0.7500,  -- below this → fallback to Rekognition
  rekognition_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  rekognition_threshold NUMERIC(5,4) NOT NULL DEFAULT 0.7000,
  rekognition_collection_id VARCHAR(256),
  require_face_match_for_attendance BOOLEAN NOT NULL DEFAULT TRUE,
  allow_manual_override BOOLEAN NOT NULL DEFAULT TRUE,
  max_retry_attempts INT NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO attendance.hrms_face_config (tenant_id, onnx_enabled, rekognition_enabled, onnx_threshold, rekognition_threshold) VALUES
  ('00000000-0000-0000-0000-000000000001', true, true, 0.7500, 0.7000)
ON CONFLICT (tenant_id) DO NOTHING;

-- ═══ Remaining gaps: Comp-off earn/redeem, auto-credit config ═══
CREATE TABLE IF NOT EXISTS leave.hrms_auto_credit_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  leave_type_id UUID NOT NULL,
  credit_method VARCHAR(16) NOT NULL DEFAULT 'annual' CHECK (credit_method IN ('annual', 'monthly', 'quarterly')),
  credit_day INT NOT NULL DEFAULT 1,
  pro_rata_for_joiners BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, leave_type_id)
);

