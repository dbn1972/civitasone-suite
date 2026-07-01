-- 0004: White-label brand configuration per tenant.
-- Each tenant gets their own branding: logo, colors, fonts, app name, favicon.
-- Examples: "Odisha Finance Dept" (state colors), "CBSE" (education blue),
-- "NRLM" (rural green), "NTPC" (PSU blue/orange). All from one platform.

CREATE TABLE IF NOT EXISTS theme.brand_config (
  tenant_id         UUID PRIMARY KEY,
  -- Identity
  app_name          TEXT NOT NULL DEFAULT 'CivitasOne',
  tagline           TEXT,
  logo_url          TEXT,                            -- SVG/PNG URL (S3/CDN)
  logo_dark_url     TEXT,                            -- Logo for dark mode
  favicon_url       TEXT,
  login_bg_url      TEXT,                            -- Background image for login page
  footer_text       TEXT,
  powered_by        TEXT DEFAULT 'Powered by CivitasOne',
  -- Colors (CSS custom properties)
  color_primary     TEXT NOT NULL DEFAULT '#1e40af', -- Primary brand color
  color_primary_fg  TEXT NOT NULL DEFAULT '#ffffff', -- Text on primary
  color_secondary   TEXT NOT NULL DEFAULT '#64748b', -- Secondary/accent
  color_accent      TEXT NOT NULL DEFAULT '#f59e0b', -- Highlight/CTA
  color_background  TEXT NOT NULL DEFAULT '#ffffff', -- Page background
  color_surface     TEXT NOT NULL DEFAULT '#f8fafc', -- Card/panel background
  color_border      TEXT NOT NULL DEFAULT '#e2e8f0', -- Border color
  color_text        TEXT NOT NULL DEFAULT '#1e293b', -- Body text
  color_muted       TEXT NOT NULL DEFAULT '#64748b', -- Secondary text
  color_success     TEXT NOT NULL DEFAULT '#16a34a',
  color_warning     TEXT NOT NULL DEFAULT '#d97706',
  color_error       TEXT NOT NULL DEFAULT '#dc2626',
  -- Typography
  font_family       TEXT NOT NULL DEFAULT 'Inter, system-ui, sans-serif',
  font_family_mono  TEXT NOT NULL DEFAULT 'JetBrains Mono, monospace',
  -- Layout
  sidebar_style     TEXT NOT NULL DEFAULT 'default',  -- default | compact | icon-only
  header_style      TEXT NOT NULL DEFAULT 'default',  -- default | centered | minimal
  border_radius     TEXT NOT NULL DEFAULT '0.5rem',   -- rounded corners
  -- Custom CSS (escape hatch for advanced customization)
  custom_css        TEXT,
  -- Metadata
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID NOT NULL,
  updated_by        UUID NOT NULL,
  version           INT NOT NULL DEFAULT 1
);

-- Preset brand templates (e.g. "India Govt Green", "Education Blue", etc.)
CREATE TABLE IF NOT EXISTS theme.brand_presets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  description       TEXT,
  -- Same color/identity fields as brand_config
  color_primary     TEXT NOT NULL,
  color_secondary   TEXT NOT NULL,
  color_accent      TEXT NOT NULL,
  color_background  TEXT NOT NULL DEFAULT '#ffffff',
  color_surface     TEXT NOT NULL DEFAULT '#f8fafc',
  font_family       TEXT NOT NULL DEFAULT 'Inter, system-ui, sans-serif',
  sidebar_style     TEXT NOT NULL DEFAULT 'default',
  preview_url       TEXT,                            -- Screenshot/preview image
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed standard presets
INSERT INTO theme.brand_presets (id, code, name, description, color_primary, color_secondary, color_accent)
VALUES
  (gen_random_uuid(), 'india_govt_green', 'India Government', 'Official tricolor-inspired palette (green header, saffron accents)', '#138808', '#000080', '#FF9933'),
  (gen_random_uuid(), 'state_odisha', 'Odisha Government', 'State emblem colors (maroon + gold)', '#800020', '#1e3a5f', '#D4AF37'),
  (gen_random_uuid(), 'education_blue', 'Education (CBSE/UGC)', 'Academic blue palette', '#1e40af', '#1e3a5f', '#f59e0b'),
  (gen_random_uuid(), 'rural_green', 'Rural Development (NRLM)', 'Nature-inspired green', '#166534', '#1e3a5f', '#84cc16'),
  (gen_random_uuid(), 'psu_corporate', 'PSU Corporate', 'Professional blue-grey', '#1e3a5f', '#374151', '#3b82f6'),
  (gen_random_uuid(), 'msme_vibrant', 'MSME / Small Business', 'Vibrant startup colors', '#7c3aed', '#1e293b', '#f59e0b'),
  (gen_random_uuid(), 'health_teal', 'Health & Medical', 'Calming teal for hospitals/AIIMS', '#0d9488', '#1e3a5f', '#06b6d4'),
  (gen_random_uuid(), 'defence_navy', 'Defence / Security', 'Navy-inspired dark palette', '#1e3a5f', '#111827', '#fbbf24')
ON CONFLICT (code) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON theme.brand_config TO theme_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON theme.brand_presets TO theme_svc;
