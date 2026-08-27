"use client";

/**
 * Brand Editor — Visual, no-code theming for tenant admins.
 *
 * Flow: Pick preset → Customize colors → Upload logo → Preview live → Save
 * No hex codes needed. Color picker + drag-drop logo + instant preview.
 *
 * This page renders a split-screen:
 * - Left: Editor panel (presets, color pickers, logo upload, font selector)
 * - Right: Live preview (miniature app shell that updates in real-time)
 */

import { useState, useEffect, useCallback } from "react";

/**
 * Pick black or white text for a given background so the pair meets WCAG 2.2 AA
 * (SC 1.4.3, 4.5:1) whatever colour a tenant chooses.
 *
 * Uses the WCAG relative-luminance formula rather than a naive brightness
 * average, because the two disagree near mid-tones — and mid-tones (amber,
 * teal) are exactly where a hardcoded white foreground fails.
 */
function readableForeground(background: string): string {
  const hex = background.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n) || full.length !== 6) return "#111827";
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  // Contrast against white vs against near-black; pick the stronger one.
  const againstWhite = 1.05 / (luminance + 0.05);
  const againstBlack = (luminance + 0.05) / 0.05;
  return againstWhite >= againstBlack ? "#ffffff" : "#111827";
}

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

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer"
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

function PresetCard({ preset, isActive, onSelect }: { preset: Preset; isActive: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all w-full text-start ${
        isActive ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300 bg-white"
      }`}
    >
      <div className="flex gap-1">
        <div className="w-6 h-6 rounded-full" style={{ backgroundColor: preset.colorPrimary }} />
        <div className="w-6 h-6 rounded-full" style={{ backgroundColor: preset.colorSecondary }} />
        <div className="w-6 h-6 rounded-full" style={{ backgroundColor: preset.colorAccent }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{preset.name}</p>
        {preset.description && <p className="text-xs text-gray-500 truncate">{preset.description}</p>}
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
        style={{ backgroundColor: config.colorPrimary, borderColor: config.colorBorder }}
      >
        {config.logoUrl ? (
          <img src={config.logoUrl} alt="Logo" className="h-8 w-auto" />
        ) : (
          <div className="h-8 w-8 rounded bg-white/20" />
        )}
        <span className="text-sm font-semibold" style={{ color: config.colorPrimaryFg }}>
          {config.appName}
        </span>
      </div>

      <div className="flex h-[400px]">
        {/* Sidebar */}
        <div className="w-48 border-e p-3 space-y-2" style={{ backgroundColor: config.colorSurface, borderColor: config.colorBorder }}>
          {["Dashboard", "Finance", "HR & Payroll", "Procurement", "Reports"].map((item, i) => (
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
          <h2 className="text-lg font-semibold" style={{ color: config.colorText }}>Dashboard</h2>

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
                style={{ backgroundColor: config.colorSurface, borderColor: config.colorBorder, borderRadius: config.borderRadius }}
              >
                <p className="text-xs" style={{ color: config.colorMuted }}>{card.label}</p>
                <p className="text-xl font-bold mt-1" style={{ color: card.color }}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* Button preview */}
          <div className="flex gap-2 mt-4">
            <button
              className="px-4 py-2 text-sm font-medium rounded-lg"
              style={{ backgroundColor: config.colorPrimary, color: config.colorPrimaryFg, borderRadius: config.borderRadius }}
            >
              Primary Action
            </button>
            <button
              className="px-4 py-2 text-sm font-medium rounded-lg border"
              style={{ color: config.colorPrimary, borderColor: config.colorBorder, borderRadius: config.borderRadius }}
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
      <div className="px-4 py-2 text-center border-t" style={{ borderColor: config.colorBorder }}>
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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    // Independent requests, independent failure handling: presets are a
    // secondary, non-essential convenience (quick-pick color themes), so a
    // presets-endpoint hiccup shouldn't block the editor from showing the
    // tenant's actual, successfully-loaded brand config — only surface an
    // error banner and degrade gracefully (empty preset list) for whichever
    // one actually failed, rather than discarding a perfectly good response
    // just because the other request in the pair had a problem.
    fetch("/api/proxy/v1/themes/brand", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`brand config: HTTP ${r.status}`);
        return r.json();
      })
      .then(setConfig)
      .catch((e) => {
        if (e.name === "AbortError") return;
        setLoadError("Couldn't load your current branding. Showing defaults — saving will still work.");
      });
    fetch("/api/proxy/v1/themes/brand/presets", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`presets: HTTP ${r.status}`);
        return r.json();
      })
      .then(setPresets)
      .catch((e) => {
        if (e.name === "AbortError") return;
        setLoadError((prev) => prev ?? "Couldn't load color presets. You can still set colors manually.");
      });
    return () => controller.abort();
  }, []);

  const updateColor = useCallback((key: keyof BrandConfig, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaved(false);
  }, []);

  const applyPreset = useCallback((preset: Preset) => {
    setConfig((prev) => ({
      ...prev,
      colorPrimary: preset.colorPrimary,
      colorSecondary: preset.colorSecondary,
      colorAccent: preset.colorAccent,
    }));
    setActivePreset(preset.code);
    setDirty(true);
    setSaved(false);
  }, []);

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
        throw new Error(`HTTP ${res.status}`);
      }
      setSaved(true);
      setDirty(false);
    } catch {
      setSaveError("Couldn't save your changes. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [config]);

  return (
    <div className="flex h-screen">
      {/* Left: Editor Panel */}
      <div className="w-[420px] border-e overflow-y-auto p-6 space-y-6 bg-white">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Brand & Theme</h1>
          <p className="text-sm text-gray-500 mt-1">Customize how your portal looks. Changes preview instantly on the right.</p>
        </div>

        {loadError && (
          <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {loadError}
          </div>
        )}

        {/* App Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">App Name</label>
          <input
            type="text"
            value={config.appName}
            onChange={(e) => updateColor("appName", e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm"
            placeholder="e.g. CBSE Administration Portal"
          />
        </div>

        {/* Logo Upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Logo</label>
          <div className="border-2 border-dashed rounded-xl p-4 text-center cursor-pointer hover:border-blue-400 transition-colors">
            {config.logoUrl ? (
              <img src={config.logoUrl} alt="Logo" className="h-12 mx-auto" />
            ) : (
              <div>
                <p className="text-sm text-gray-500">Drag & drop logo here</p>
                <p className="text-xs text-gray-500 mt-1">SVG or PNG, max 200KB</p>
              </div>
            )}
            <input
              type="text"
              value={config.logoUrl ?? ""}
              onChange={(e) => updateColor("logoUrl", e.target.value)}
              className="w-full px-2 py-1 border rounded text-xs mt-2"
              placeholder="Or paste image URL"
            />
          </div>
        </div>

        {/* Presets */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Quick Presets</h3>
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
            <ColorPicker label="Primary" value={config.colorPrimary} onChange={(v) => updateColor("colorPrimary", v)} />
            <ColorPicker label="Secondary" value={config.colorSecondary} onChange={(v) => updateColor("colorSecondary", v)} />
            <ColorPicker label="Accent" value={config.colorAccent} onChange={(v) => updateColor("colorAccent", v)} />
            <ColorPicker label="Background" value={config.colorBackground} onChange={(v) => updateColor("colorBackground", v)} />
            <ColorPicker label="Surface" value={config.colorSurface} onChange={(v) => updateColor("colorSurface", v)} />
            <ColorPicker label="Text" value={config.colorText} onChange={(v) => updateColor("colorText", v)} />
            <ColorPicker label="Success" value={config.colorSuccess} onChange={(v) => updateColor("colorSuccess", v)} />
            <ColorPicker label="Warning" value={config.colorWarning} onChange={(v) => updateColor("colorWarning", v)} />
            <ColorPicker label="Error" value={config.colorError} onChange={(v) => updateColor("colorError", v)} />
          </div>
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
            onChange={(e) => updateColor("borderRadius", `${Number(e.target.value) / 16}rem`)}
            className="w-full"
            aria-describedby="branding-border-radius-value"
          />
          <p id="branding-border-radius-value" className="text-xs text-gray-500 mt-1">
            {config.borderRadius}
          </p>
        </div>

        {/* Save Button */}
        <div className="sticky bottom-0 bg-white pt-4 border-t space-y-2">
          {saveError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {saveError}
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className={`w-full py-3 rounded-xl font-medium text-sm transition-all ${
              dirty
                ? "bg-blue-600 text-white hover:bg-blue-700 shadow-lg"
                : saved
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-500 cursor-not-allowed"
            }`}
          >
            {saving ? "Saving..." : saved ? "✓ Saved!" : dirty ? "Save Changes" : "No Changes"}
          </button>
        </div>
      </div>

      {/* Right: Live Preview */}
      <div className="flex-1 p-8 bg-gray-50 overflow-y-auto">
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
    </div>
  );
}
