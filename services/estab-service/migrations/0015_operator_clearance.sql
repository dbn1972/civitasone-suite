-- estab-service: CSMOP classification-based access control.
-- Additive, idempotent. Each enrolled eOffice operator carries a security
-- clearance rank; a file may only be opened/marked by an officer whose
-- clearance >= the file's classification (public<confidential<secret<top_secret).
ALTER TABLE files.estab_file_operator
  ADD COLUMN IF NOT EXISTS clearance_level integer NOT NULL DEFAULT 1; -- 1 public, 2 confidential, 3 secret, 4 top_secret
