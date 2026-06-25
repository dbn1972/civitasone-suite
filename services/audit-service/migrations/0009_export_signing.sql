-- Wave 3 (additive + idempotent). Applied on civitas_audit after 0008_wave2.sql.
-- AUD-2: signed / tamper-evident export artifacts (the regulator deliverable).
--
-- Until now an export artifact was written to disk and guarded only by an opaque
-- download_token (an ACCESS control). There was no INTEGRITY control: a file
-- altered on disk would be served as-is and a regulator could not prove the
-- artifact had not been tampered with. This migration adds the columns needed to
-- persist a content digest (SHA-256) and a detached HMAC-SHA256 signature over a
-- canonical manifest, so any byte-level change to the artifact is detectable and
-- the signature is verifiable by anyone holding the signing key.
--
-- exports.exports is audit_svc-owned; run as audit_svc. All statements idempotent.

ALTER TABLE exports.exports ADD COLUMN IF NOT EXISTS content_sha256 varchar(64);
ALTER TABLE exports.exports ADD COLUMN IF NOT EXISTS signature      text;
ALTER TABLE exports.exports ADD COLUMN IF NOT EXISTS signed_at      timestamptz;
-- key id (not the secret) so a verifier knows which signing key was used and
-- keys can be rotated without ambiguity.
ALTER TABLE exports.exports ADD COLUMN IF NOT EXISTS signing_key_id varchar(64);
-- algorithm tag, e.g. 'HMAC-SHA256', for forward compatibility / verification.
ALTER TABLE exports.exports ADD COLUMN IF NOT EXISTS signature_alg  varchar(32);
