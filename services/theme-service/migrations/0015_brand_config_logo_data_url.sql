-- 0015_brand_config_logo_data_url.sql
-- Purpose: store an uploaded tenant logo (raster data: URL) in its own column so
--   `logo_url` can stay an external https URL. Before this the web editor put a
--   data: URL into logo_url, which the API's z.string().url() check rejected, so
--   an uploaded logo could never be saved (docs/gap-closure/w0-report.md).
-- Safety: raster formats only (png/jpeg/webp). SVG is NOT allowed - there is no
--   server-side SVG sanitiser. The CHECK is defence in depth behind the API's
--   decoded-size (<=200KB) and magic-byte validation; the length bound mirrors
--   ceil(200KB*4/3)+64 base64 chars.
-- RLS: theme.brand_config is already ENABLE+FORCE ROW LEVEL SECURITY with a
--   USING+WITH CHECK tenant policy (0005); a new column inherits it.
-- Idempotent: ADD COLUMN IF NOT EXISTS; constraint guarded by duplicate_object.
-- Rollback:
--   ALTER TABLE theme.brand_config DROP CONSTRAINT IF EXISTS brand_config_logo_data_url_check;
--   ALTER TABLE theme.brand_config DROP COLUMN IF EXISTS logo_data_url;
-- Affected services: theme-service

SET lock_timeout = '5s';

ALTER TABLE theme.brand_config ADD COLUMN IF NOT EXISTS logo_data_url text;

DO $$ BEGIN
  ALTER TABLE theme.brand_config
    ADD CONSTRAINT brand_config_logo_data_url_check
    CHECK (
      logo_data_url IS NULL
      OR (
        length(logo_data_url) <= 273131
        AND logo_data_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
