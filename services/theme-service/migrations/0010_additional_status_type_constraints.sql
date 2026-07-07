-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to 0007_check_constraints_status_columns.sql)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: theme-service

SET lock_timeout = '5s';

-- ============================================================================
-- theme.brand_config.sidebar_style
-- Valid states: default, compact, expanded (source: modules/tokens/
-- brand-routes.ts sidebarStyle z.enum(["default","compact","expanded"]);
-- schema.ts default "default")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE theme.brand_config
    ADD CONSTRAINT brand_config_sidebar_style_check
    CHECK (sidebar_style IN ('default', 'compact', 'expanded'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- theme.brand_config.header_style
-- Valid states: default, minimal, branded (source: modules/tokens/
-- brand-routes.ts headerStyle z.enum(["default","minimal","branded"]);
-- schema.ts default "default")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE theme.brand_config
    ADD CONSTRAINT brand_config_header_style_check
    CHECK (header_style IN ('default', 'minimal', 'branded'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- theme.brand_presets.sidebar_style
-- Valid states: default, compact, expanded (same enum as brand_config — preset
-- rows provide pre-configured style values that get applied to brand_config
-- when a tenant selects a preset; brand-routes.ts validateBrandPreset)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE theme.brand_presets
    ADD CONSTRAINT brand_presets_sidebar_style_check
    CHECK (sidebar_style IN ('default', 'compact', 'expanded'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE theme.brand_config VALIDATE CONSTRAINT brand_config_sidebar_style_check;
ALTER TABLE theme.brand_config VALIDATE CONSTRAINT brand_config_header_style_check;
ALTER TABLE theme.brand_presets VALIDATE CONSTRAINT brand_presets_sidebar_style_check;
