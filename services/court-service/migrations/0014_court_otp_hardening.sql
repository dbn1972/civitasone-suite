-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0014_court_otp_hardening.sql
-- Adds ip_hash to court.otp_challenges for per-IP OTP-request rate limiting
-- (anti SMS-bombing: the per-mobile cap alone cannot stop an attacker submitting
-- unlimited DISTINCT numbers from one source). Additive + idempotent. No RLS
-- (otp_challenges is a pre-auth registry, per 0013).
-- ═══════════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';
ALTER TABLE court.otp_challenges ADD COLUMN IF NOT EXISTS ip_hash varchar(64);
CREATE INDEX IF NOT EXISTS idx_otp_challenges_ip_created ON court.otp_challenges (ip_hash, created_at);
