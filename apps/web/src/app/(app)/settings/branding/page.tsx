"use client";

/**
 * Brand Editor — Visual, no-code theming for tenant admins.
 *
 * Flow: Pick preset → Customize colors → Upload logo → Preview live → Save
 * No hex codes needed. Color picker + logo URL + instant preview.
 *
 * This page renders a responsive split-screen:
 * - Editor panel (presets, color pickers, logo, footer/tagline/powered-by text)
 * - Live preview (miniature app shell that updates in real-time)
 * On small screens the panels stack; on lg+ they sit side by side.
 *
 * Foreground/contrast maths lives in @/lib/contrast (readableForeground,
 * contrastRatio) so every surface that needs an accessible pairing shares one
 * WCAG implementation rather than re-deriving luminance locally.
 */

import { useState, useEffect, useCallback } from "react";
import {
  readableForeground,
  contrastRatio,
  WCAG_AA_NORMAL,
} from "@/lib/contrast";
import { useSessionIdentity } from "@/lib/auth/useSessionIdentity";
import { ConfirmDialog } from "@/app/_components/ds";

// Roles allowed to edit tenant-wide branding. This is a DISPLAY gate only —
// theme-service PUT /v1/themes/brand independently calls requireRole with the
// same set (see tokens/brand-routes.ts ADMIN_ROLES), so hiding the controls
// here can never grant access, only avoid offering a Save that would 403.
const BRANDING_ADMIN_ROLES = ["theme_admin", "super_admin", "tenant_admin"];

// Logo upload constraints (GAP-SETTINGS-BRANDING-04). Module scope so the
// handler's useCallback deps stay stable.
const MAX_LOGO_BYTES = 200 * 1024;
const ALLOWED_LOGO_TYPES = ["image/png", "image/svg+xml"];

// ── Types ────────────────────────────────────────────────────────────────────

type BrandConfig = {
  appName: string;
  tagline: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  loginBgUrl: string | null;
  footerText: string | null;
  poweredBy: string | null;
  colorPrimary: string;
  colorPrimaryFg: string;
  colorSecondary: string;
  colorAccent: string;
  colorBackground: string;
  colorSurface: string;
  colorBorder: string;
  colorText: string;
  colorMuted: string;
  colorSuccess: string;
  colorWarning: string;
  colorError: string;
  fontFamily: string;
  fontFamilyMono: string;
  sidebarStyle: string;
  headerStyle: string;
  borderRadius: string;
  customCss: string | null;
};

type Preset = {
  code: string;
  name: string;
  description: string | null;
  colorPrimary: string;
  colorSecondary: string;
  colorAccent: string;
};

// ── Color Picker Component ───────────────────────────────────────────────────

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer"
        aria-label={label}
        title={label}
      />
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <p className="text-xs text-gray-500 font-mono">{value}</p>
      </div>
    </div>
  );
}

// ── Preset Card ──────────────────────────────────────────────────────────────

function PresetCard({
  preset,
  isActive,
  onSelect,
}: {
  preset: Preset;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all w-full text-start ${
        isActive
          ? "border-blue-500 bg-blue-50"
          : "border-gray-200 hover:border-gray-300 bg-white"
      }`}
    >
      <div className="flex gap-1">
        <div
          className="w-6 h-6 rounded-full"
          style={{ backgroundColor: preset.colorPrimary }}
        />
        <div
          className="w-6 h-6 rounded-full"
          style={{ backgroundColor: preset.colorSecondary }}
        />
        <div
          className="w-6 h-6 rounded-full"
          style={{ backgroundColor: preset.colorAccent }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{preset.name}</p>
        {preset.description && (
          <p className="text-xs text-gray-500 truncate">{preset.description}</p>
        )}
      </div>
      {isActive && <span className="text-blue-500 text-sm">✓</span>}
    </button>
  );
}

// ── Live Preview ─────────────────────────────────────────────────────────────

function LivePreview({ config }: { config: BrandConfig }) {
  return (
    <div
      className="rounded-2xl border shadow-lg overflow-hidden h-full"
      style={{
        backgroundColor: config.colorBackground,
        fontFamily: config.fontFamily,
        borderColor: config.colorBorder,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b"
        style={{
          backgroundColor: config.colorPrimary,
          borderColor: config.colorBorder,
        }}
      >
        {config.logoUrl ? (
          <img src={config.logoUrl} alt="Logo" className="h-8 w-auto" />
        ) : (
          <div className="h-8 w-8 rounded bg-white/20" />
        )}
        <span
          className="text-sm font-semibold"
          style={{ color: config.colorPrimaryFg }}
        >
          {config.appName}
        </span>
        {config.tagline && (
          <span className="text-xs opacity-80" style={{ color: config.colorPrimaryFg }}>
            {config.tagline}
          </span>
        )}
      </div>

      <div className="flex h-[400px]">
        {/* Sidebar */}
        <div
          className="w-48 border-e p-3 space-y-2"
          style={{
            backgroundColor: config.colorSurface,
            borderColor: config.colorBorder,
          }}
        >
          {[
            "Dashboard",
            "Finance",
            "HR & Payroll",
            "Procurement",
            "Reports",
          ].map((item, i) => (
            <div
              key={item}
              className="px-3 py-2 rounded-lg text-xs font-medium"
              style={{
                backgroundColor: i === 0 ? config.colorPrimary : "transparent",
                color: i === 0 ? config.colorPrimaryFg : config.colorText,
              }}
            >
              {item}
            </div>
          ))}
        </div>

        {/* Main content area */}
        <div className="flex-1 p-4 space-y-4">
          <h2
            className="text-lg font-semibold"
            style={{ color: config.colorText }}
          >
            Dashboard
          </h2>

          {/* Card grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Revenue", value: "₹12.4L", color: config.colorSuccess },
              { label: "Pending", value: "23", color: config.colorWarning },
              { label: "Employees", value: "156", color: config.colorPrimary },
              { label: "Alerts", value: "3", color: config.colorError },
            ].map((card) => (
              <div
                key={card.label}
                className="p-3 rounded-xl border"
                style={{
                  backgroundColor: config.colorSurface,
                  borderColor: config.colorBorder,
                  borderRadius: config.borderRadius,
                }}
              >
                <p className="text-xs" style={{ color: config.colorMuted }}>
                  {card.label}
                </p>
                <p
                  className="text-xl font-bold mt-1"
                  style={{ color: card.color }}
                >
                  {card.value}
                </p>
              </div>
            ))}
          </div>

          {/* Button preview */}
          <div className="flex gap-2 mt-4">
            <button
              className="px-4 py-2 text-sm font-medium rounded-lg"
              style={{
                backgroundColor: config.colorPrimary,
                color: config.colorPrimaryFg,
                borderRadius: config.borderRadius,
              }}
            >
              Primary Action
            </button>
            <button
              className="px-4 py-2 text-sm font-medium rounded-lg border"
              style={{
                color: config.colorPrimary,
                borderColor: config.colorBorder,
                borderRadius: config.borderRadius,
              }}
            >
              Secondary
            </button>
            <button
              className="px-4 py-2 text-sm font-medium rounded-lg"
              style={{
                backgroundColor: config.colorAccent,
                // Was hardcoded "#fff", which gave 2.14:1 on the default amber
                // accent (#f59e0b) and failed WCAG 2.2 AA SC 1.4.3. The
                // foreground is now derived from the chosen accent's luminance,
                // so the preview stays readable for ANY tenant accent colour and
                // demonstrates an accessible pairing rather than a broken one.
                color: readableForeground(config.colorAccent),
                borderRadius: config.borderRadius,
              }}
            >
              Accent
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        className="px-4 py-2 text-center border-t"
        style={{ borderColor: config.colorBorder }}
      >
        {config.footerText && (
          <p className="text-xs" style={{ color: config.colorText }}>
            {config.footerText}
          </p>
        )}
        <p className="text-xs" style={{ color: config.colorMuted }}>
          {config.poweredBy ?? "Powered by CivitasOne"}
        </p>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function BrandingPage() {
  const [config, setConfig] = useState<BrandConfig>({
    appName: "CivitasOne",
    tagline: null,
    logoUrl: null,
    logoDarkUrl: null,
    faviconUrl: null,
    loginBgUrl: null,
    footerText: null,
    poweredBy: "Powered by CivitasOne",
    colorPrimary: "#1e40af",
    colorPrimaryFg: "#ffffff",
    colorSecondary: "#64748b",
    colorAccent: "#f59e0b",
    colorBackground: "#ffffff",
    colorSurface: "#f8fafc",
    colorBorder: "#e2e8f0",
    colorText: "#1e293b",
    colorMuted: "#64748b",
    colorSuccess: "#16a34a",
    colorWarning: "#d97706",
    colorError: "#dc2626",
    fontFamily: "Inter, system-ui, sans-serif",
    fontFamilyMono: "JetBrains Mono, monospace",
    sidebarStyle: "default",
    headerStyle: "default",
    borderRadius: "0.5rem",
    customCss: null,
  });

  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const identity = useSessionIdentity();
  const canEdit =
    !identity.loaded ||
    identity.roles.some((r) => BRANDING_ADMIN_ROLES.includes(r));

  // Load current brand + presets on mount.
  //
  // These are client-component fetches, so — unlike the server-loader pages
  // under (app)/themes/* — they can't call the gateway's /api/v1/... path
  // directly (there is no Next.js route at that path; apps/web/src/app/api
  // has no v1/ subtree, and next.config.mjs declares no rewrite for it, so
  // that request 404's against the Next server itself and never reaches
  // theme-service). Client-side calls in this codebase go through the
  // authenticated proxy instead — see PluginActions.tsx / ThemeActions.tsx
  // for the same /api/proxy/v1/... pattern used for mutations.
  //
  // Previously this fetch failed silently (only AbortError was handled) and
  // the editor just sat on its hardcoded default BrandConfig with no
  // indication anything was wrong, which reads as "your portal has no brand
  // config yet" rather than "this couldn't load".
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    setLoading(true);
    // Independent requests, independent failure handling: presets are a
    // secondary, non-essential convenience (quick-pick color themes), so a
    // presets-endpoint hiccup shouldn't block the editor from showing the
    // tenant's actual, successfully-loaded brand config — only surface an
    // error banner and degrade gracefully (empty preset list) for whichever
    // one actually failed, rather than discarding a perfectly good response
    // just because the other request in the pair had a problem.
    const brandLoad = fetch("/api/proxy/v1/themes/brand", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`brand config: HTTP ${r.status}`);
        return r.json();
      })
      .then((loaded: BrandConfig) => {
        // The stored colorPrimaryFg can be stale (e.g. saved before this
        // editor derived it). Recompute it from the loaded primary so the
        // header / active nav / Primary Action never render an unreadable
        // pair, even on first paint. (GAP-SETTINGS-BRANDING-01)
        setConfig({
          ...loaded,
          colorPrimaryFg: readableForeground(loaded.colorPrimary),
        });
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setLoadError(
          "Couldn't load your current branding. Showing defaults — review before saving.",
        );
      });
    const presetLoad = fetch("/api/proxy/v1/themes/brand/presets", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`presets: HTTP ${r.status}`);
        return r.json();
      })
      .then(setPresets)
      .catch((e) => {
        if (e.name === "AbortError") return;
        setLoadError(
          (prev) =>
            prev ??
            "Couldn't load color presets. You can still set colors manually.",
        );
      });
    void Promise.allSettled([brandLoad, presetLoad]).then(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  const updateColor = useCallback((key: keyof BrandConfig, value: string) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      // Keep the primary foreground readable for ANY chosen primary; the one
      // persisted pair must meet WCAG AA. (GAP-SETTINGS-BRANDING-01)
      if (key === "colorPrimary") {
        next.colorPrimaryFg = readableForeground(value);
      }
      return next;
    });
    setDirty(true);
    setSaved(false);
  }, []);

  const applyPreset = useCallback((preset: Preset) => {
    setConfig((prev) => ({
      ...prev,
      colorPrimary: preset.colorPrimary,
      colorPrimaryFg: readableForeground(preset.colorPrimary),
      colorSecondary: preset.colorSecondary,
      colorAccent: preset.colorAccent,
    }));
    setActivePreset(preset.code);
    setDirty(true);
    setSaved(false);
  }, []);

  // Logo handling (GAP-SETTINGS-BRANDING-04).
  // Accept only PNG/SVG up to 200KB. We read the file to a data: URL, which
  // the app CSP already permits (img-src 'self' data: blob:) — an arbitrary
  // external https URL would be blocked in the browser and also leaks viewer
  // IPs, so the free-text URL box is validated separately below and is an
  // advanced fallback only. SVG can carry script; the backend sanitises /
  // restricts on upload, and in-browser an <img src=data:svg> cannot run
  // script, so the preview is safe.
  const handleLogoFile = useCallback((file: File | null | undefined) => {
    if (!file) return;
    setLogoError(null);
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setLogoError("Logo must be a PNG or SVG image.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError("Logo must be 200KB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) {
        setLogoError("Couldn't read that file. Please try another.");
        return;
      }
      updateColor("logoUrl", result);
    };
    reader.onerror = () => setLogoError("Couldn't read that file. Please try another.");
    reader.readAsDataURL(file);
  }, [updateColor]);

  const setLogoUrlFromText = useCallback((raw: string) => {
    setLogoError(null);
    const value = raw.trim();
    if (value === "") {
      updateColor("logoUrl", "");
      return;
    }
    // Allow only https:// or data: image URLs. http/javascript/other schemes
    // are rejected: they either leak viewer IPs, break under the CSP, or are
    // an injection vector.
    const isHttps = /^https:\/\//i.test(value);
    const isDataImage = /^data:image\/(png|svg\+xml);/i.test(value);
    if (!isHttps && !isDataImage) {
      setLogoError("Enter an https:// image URL (or upload a file).");
      return;
    }
    updateColor("logoUrl", value);
  }, [updateColor]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/proxy/v1/themes/brand", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      // Previously unchecked: this always showed "✓ Saved!" regardless of the
      // actual response, including on the 404 the un-proxied path always
      // produced — i.e. it claimed success on every save while persisting
      // nothing. A tenant admin had no way to know their branding never
      // stuck.
      if (!res.ok) {
        throw new Error("branding_save_failed");
      }
      setSaved(true);
      setDirty(false);
    } catch {
      setSaveError("Couldn't save your changes. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [config]);

  // Contrast checks for the pairs a tenant can actually make unreadable.
  // Text-on-Background / Text-on-Surface / Primary-on-PrimaryFg below AA are
  // "critical" (they make core UI unreadable) and block Save until fixed;
  // Muted-on-Background is a warning only. (GAP-SETTINGS-BRANDING-06)
  const contrastIssues = (() => {
    const checks: { label: string; ratio: number; critical: boolean }[] = [
      { label: "Text on Background", ratio: contrastRatio(config.colorText, config.colorBackground), critical: true },
      { label: "Text on Surface", ratio: contrastRatio(config.colorText, config.colorSurface), critical: true },
      { label: "Primary button text", ratio: contrastRatio(config.colorPrimaryFg, config.colorPrimary), critical: true },
      { label: "Muted text on Background", ratio: contrastRatio(config.colorMuted, config.colorBackground), critical: false },
    ];
    return checks.filter((c) => c.ratio < WCAG_AA_NORMAL);
  })();
  const hasCriticalContrastIssue = contrastIssues.some((c) => c.critical);

  const requestSave = useCallback(() => {
    setConfirmingSave(true);
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading your branding…</span>
        <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-72 animate-pulse rounded bg-gray-100" />
        <div className="space-y-3 pt-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  return (
    // A bespoke split-screen editor (live preview on the right), not a list/detail
    // page, so it deliberately doesn't use the shared PageHeader chrome (back link
    // + "How this works") which is built for the page-main/wrap layout and would
    // eat into the fixed-height editor panel. It still gets the same id'd <h1> +
    // aria-labelledby every other page has (UX-007) — on a <div> here rather than
    // a <main>, since AppShell already supplies the page's one true <main> landmark
    // and a second one would violate the one-main-per-document rule (a11y HIGH-1).
    <div
      className="flex min-h-0 flex-col lg:h-screen lg:flex-row"
      aria-labelledby="page-heading"
    >
      {/* Editor Panel — full width on small screens, fixed rail on lg+ */}
      <div className="w-full border-b lg:w-[420px] lg:border-b-0 lg:border-e lg:overflow-y-auto p-6 space-y-6 bg-white">
        <div>
          <h1 id="page-heading" className="text-2xl font-bold text-gray-900">
            Brand & Theme
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Customize how your portal looks. Changes preview instantly below.
          </p>
        </div>

        {!canEdit && identity.loaded && (
          <div
            role="status"
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
          >
            You can preview the current branding, but only a tenant or theme
            administrator can change it. Save is disabled.
          </div>
        )}

        {loadError && (
          <div
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            {loadError}
          </div>
        )}

        {/* App Name */}
        <div>
          <label htmlFor="branding-app-name" className="block text-sm font-medium text-gray-700 mb-1">
            App Name
          </label>
          <input
            id="branding-app-name"
            type="text"
            value={config.appName}
            onChange={(e) => updateColor("appName", e.target.value)}
            disabled={!canEdit}
            className="w-full px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
            placeholder="e.g. CBSE Administration Portal"
          />
        </div>

        {/* Tagline */}
        <div>
          <label htmlFor="branding-tagline" className="block text-sm font-medium text-gray-700 mb-1">
            Tagline
          </label>
          <input
            id="branding-tagline"
            type="text"
            value={config.tagline ?? ""}
            onChange={(e) => updateColor("tagline", e.target.value)}
            disabled={!canEdit}
            maxLength={256}
            className="w-full px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
            placeholder="e.g. Serving citizens, digitally"
          />
        </div>

        {/* Footer text */}
        <div>
          <label htmlFor="branding-footer-text" className="block text-sm font-medium text-gray-700 mb-1">
            Footer text
          </label>
          <input
            id="branding-footer-text"
            type="text"
            value={config.footerText ?? ""}
            onChange={(e) => updateColor("footerText", e.target.value)}
            disabled={!canEdit}
            maxLength={512}
            className="w-full px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
            placeholder="e.g. © 2026 Municipal Corporation"
          />
        </div>

        {/* Powered-by line */}
        <div>
          <label htmlFor="branding-powered-by" className="block text-sm font-medium text-gray-700 mb-1">
            Powered-by line
          </label>
          <input
            id="branding-powered-by"
            type="text"
            value={config.poweredBy ?? ""}
            onChange={(e) => updateColor("poweredBy", e.target.value)}
            disabled={!canEdit}
            maxLength={128}
            className="w-full px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
            placeholder="Powered by CivitasOne"
          />
        </div>

        {/* Logo */}
        <div>
          {/* Not a <label>: this heads a drag-and-drop zone plus a file input
              and a fallback URL text input, not one single control it could be
              htmlFor-linked to — each inner control carries its own label. */}
          <p className="block text-sm font-medium text-gray-700 mb-1">
            Logo
          </p>
          <div
            onDragOver={(e) => {
              if (!canEdit) return;
              e.preventDefault();
            }}
            onDrop={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              handleLogoFile(e.dataTransfer.files?.[0]);
            }}
            className="border-2 border-dashed rounded-xl p-4 text-center hover:border-blue-400 transition-colors"
          >
            {config.logoUrl ? (
              <img src={config.logoUrl} alt="Logo preview" className="h-12 mx-auto" />
            ) : (
              <div>
                <p className="text-sm text-gray-500">Drag &amp; drop a logo here</p>
                <p className="text-xs text-gray-500 mt-1">PNG or SVG, max 200KB</p>
              </div>
            )}
            <label
              htmlFor="branding-logo-file"
              className="mt-3 inline-block cursor-pointer rounded-lg border px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Choose file
            </label>
            <input
              id="branding-logo-file"
              type="file"
              accept="image/png,image/svg+xml"
              disabled={!canEdit}
              onChange={(e) => handleLogoFile(e.target.files?.[0])}
              className="sr-only"
            />
            <details className="mt-3 text-start">
              <summary className="cursor-pointer text-xs text-gray-500">
                Advanced: use an image URL
              </summary>
              <input
                type="text"
                aria-label="Logo image URL"
                defaultValue={config.logoUrl ?? ""}
                onBlur={(e) => setLogoUrlFromText(e.target.value)}
                disabled={!canEdit}
                className="w-full px-2 py-1 border rounded text-xs mt-2 disabled:bg-gray-50"
                placeholder="https://… (https only)"
              />
            </details>
          </div>
          {logoError && (
            <p role="alert" className="text-xs text-red-700 mt-1">
              {logoError}
            </p>
          )}
        </div>

        {/* Presets */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Quick Presets
          </h3>
          <div className="space-y-2">
            {presets.map((p) => (
              <PresetCard
                key={p.code}
                preset={p}
                isActive={activePreset === p.code}
                onSelect={() => applyPreset(p)}
              />
            ))}
          </div>
        </div>

        {/* Colors */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Colors</h3>
          <div className="space-y-1">
            <ColorPicker
              label="Primary"
              value={config.colorPrimary}
              onChange={(v) => updateColor("colorPrimary", v)}
            />
            <ColorPicker
              label="Secondary"
              value={config.colorSecondary}
              onChange={(v) => updateColor("colorSecondary", v)}
            />
            <ColorPicker
              label="Accent"
              value={config.colorAccent}
              onChange={(v) => updateColor("colorAccent", v)}
            />
            <ColorPicker
              label="Background"
              value={config.colorBackground}
              onChange={(v) => updateColor("colorBackground", v)}
            />
            <ColorPicker
              label="Surface"
              value={config.colorSurface}
              onChange={(v) => updateColor("colorSurface", v)}
            />
            <ColorPicker
              label="Text"
              value={config.colorText}
              onChange={(v) => updateColor("colorText", v)}
            />
            <ColorPicker
              label="Success"
              value={config.colorSuccess}
              onChange={(v) => updateColor("colorSuccess", v)}
            />
            <ColorPicker
              label="Warning"
              value={config.colorWarning}
              onChange={(v) => updateColor("colorWarning", v)}
            />
            <ColorPicker
              label="Error"
              value={config.colorError}
              onChange={(v) => updateColor("colorError", v)}
            />
          </div>
          {contrastIssues.length > 0 && (
            <div
              role="alert"
              className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1"
            >
              <p className="font-medium">
                Some colour pairs are hard to read (WCAG AA needs 4.5:1):
              </p>
              <ul className="list-disc ps-4">
                {contrastIssues.map((c) => (
                  <li key={c.label}>
                    {c.label}: {c.ratio.toFixed(2)}:1
                    {c.critical ? " — must fix before saving" : " — consider adjusting"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Border Radius */}
        <div>
          {/* The visible label was not associated with the input (no htmlFor/id),
              so axe reported a CRITICAL `label` violation — screen readers
              announced an unlabelled slider. WCAG 2.2 AA SC 1.3.1 / 4.1.2. */}
          <label
            htmlFor="branding-border-radius"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Corner Roundness
          </label>
          <input
            id="branding-border-radius"
            type="range"
            min="0"
            max="20"
            value={parseFloat(config.borderRadius) * 16}
            onChange={(e) =>
              updateColor("borderRadius", `${Number(e.target.value) / 16}rem`)
            }
            disabled={!canEdit}
            className="w-full"
            aria-describedby="branding-border-radius-value"
          />
          <p
            id="branding-border-radius-value"
            className="text-xs text-gray-500 mt-1"
          >
            {config.borderRadius}
          </p>
        </div>

        {/* Save Button */}
        <div className="sticky bottom-0 bg-white pt-4 border-t space-y-2">
          {saveError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {saveError}
            </div>
          )}
          <button
            onClick={requestSave}
            disabled={!canEdit || !dirty || saving || hasCriticalContrastIssue}
            title={
              !canEdit
                ? "You don't have permission to change branding"
                : hasCriticalContrastIssue
                  ? "Fix the critical contrast issues before saving"
                  : undefined
            }
            className={`w-full py-3 rounded-xl font-medium text-sm transition-all ${
              dirty && canEdit && !hasCriticalContrastIssue
                ? "bg-blue-600 text-white hover:bg-blue-700 shadow-lg"
                : saved
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-500 cursor-not-allowed"
            }`}
          >
            {saving
              ? "Saving..."
              : saved
                ? "✓ Saved!"
                : hasCriticalContrastIssue
                  ? "Fix contrast to save"
                  : dirty
                    ? "Save Changes"
                    : "No Changes"}
          </button>
        </div>
      </div>

      {/* Live Preview — stacks below the editor on small screens */}
      <div className="flex-1 p-6 lg:p-8 bg-gray-50 lg:overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-500">LIVE PREVIEW</h2>
            <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
              Real-time
            </span>
          </div>
          <LivePreview config={config} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmingSave}
        title="Save branding for everyone in this tenant?"
        description="These colours, logo and text apply to every user in your organisation. Saving replaces the current branding."
        confirmLabel="Save branding"
        cancelLabel="Keep editing"
        busy={saving}
        onCancel={() => setConfirmingSave(false)}
        onConfirm={() => {
          setConfirmingSave(false);
          void handleSave();
        }}
      />
    </div>
  );
}
