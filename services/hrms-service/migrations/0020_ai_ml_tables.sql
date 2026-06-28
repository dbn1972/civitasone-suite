-- 0020: AI/ML Infrastructure Tables
-- Face embeddings, verification logs

CREATE TABLE IF NOT EXISTS hrms.face_embeddings (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  embedding TEXT NOT NULL, -- JSON array of 128 floats (FaceNet embedding)
  photo_key TEXT NOT NULL, -- S3 key of enrollment photo
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, employee_id)
);

CREATE TABLE IF NOT EXISTS hrms.face_verification_log (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  selfie_key TEXT NOT NULL,
  similarity DOUBLE PRECISION NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('PASS', 'LOW_CONFIDENCE', 'FAIL')),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_face_verif_employee ON hrms.face_verification_log (tenant_id, employee_id, verified_at DESC);
