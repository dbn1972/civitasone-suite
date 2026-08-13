-- Migration: 0022_pincode_schema.sql
-- Purpose: pincode lookup table (India Post reference data, tenant-agnostic)
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS pincode AUTHORIZATION location_svc;

CREATE TABLE IF NOT EXISTS pincode.pincodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pincode VARCHAR(6) NOT NULL,
  post_office VARCHAR(200) NOT NULL,
  district VARCHAR(120) NOT NULL,
  state VARCHAR(120) NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_pincodes_code ON pincode.pincodes(pincode);
