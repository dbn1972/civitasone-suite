"use client";

/**
 * GAP-THEMES-BRAND-01 — the brand page's preview + activation UI.
 *
 * Previously /themes/brand rendered presets as plain text rows (status was just
 * the word "active"), with no colour/logo preview and no way to activate a
 * preset. This shows the ACTIVE brand as colour swatches + logo with an
 * "Active" StatusPill, and each preset as a swatch card with an audited
 * Activate control. Activate POSTs the admin-gated, audited
 * /v1/themes/brand/apply-preset endpoint (theme-service writes the preset's
 * colours into brand_config and emits a brandPresetApplied + audit event in
 * one transaction). Non-admins get no Activate control (the server also
 * enforces theme_admin/super_admin).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, StatusPill, ConfirmDialog } from "@/app/_components/ds";
import type { BrandConfigView, BrandPresetView } from "../_data";

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <span
        aria-hidden="true"
        style={{ width: 28, height: 28, borderRadius: 6, background: color, border: "1px solid var(--line)" }}
      />
      <span style={{ fontSize: 10, color: "var(--mut)" }}>{label}</span>
    </span>
  );
}

function SwatchRow({ colors }: { colors: { color: string; label: string }[] }) {
  return (
    <span style={{ display: "inline-flex", gap: 10, flexWrap: "wrap" }} role="img" aria-label="brand colour swatches">
      {colors.map((c) => (
        <Swatch key={c.label} color={c.color} label={c.label} />
      ))}
    </span>
  );
}

/** The tenant's currently-active brand: logo + colour swatches + an Active pill. */
export function BrandPreview({ config }: { config: BrandConfigView | null }) {
  if (!config) {
    return (
      <Card title="Active brand">
        <div className="pad">
          <p style={{ color: "var(--mut)", margin: 0 }}>No brand configured — the platform default is in use.</p>
        </div>
      </Card>
    );
  }
  return (
    <Card title="Active brand">
      <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {config.logoUrl ? (
              <img src={config.logoUrl} alt={`${config.appName} logo`} style={{ height: 32, maxWidth: 160, objectFit: "contain" }} />
            ) : (
              <span
                aria-hidden="true"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  height: 32, padding: "0 12px", borderRadius: 6,
                  background: config.colorPrimary, color: config.colorPrimaryFg, fontWeight: 600, fontSize: 13,
                }}
              >
                {config.appName}
              </span>
            )}
            <strong style={{ fontSize: 15 }}>{config.appName}</strong>
          </div>
          <StatusPill status="active" label="Active" />
        </div>
        <SwatchRow
          colors={[
            { color: config.colorPrimary, label: "Primary" },
            { color: config.colorSecondary, label: "Secondary" },
            { color: config.colorAccent, label: "Accent" },
            { color: config.colorBackground, label: "Background" },
            { color: config.colorSurface, label: "Surface" },
          ]}
        />
      </div>
    </Card>
  );
}

/** The preset gallery; each card shows swatches and (for admins) an Activate control. */
export function BrandPresetGallery({
  presets,
  canActivate,
  activeHint,
}: {
  presets: BrandPresetView[];
  canActivate: boolean;
  /** The active brand's primary colour, used to badge a matching preset. */
  activeHint?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function activate(code: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/proxy/v1/themes/brand/apply-preset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!(res.ok || res.status === 202)) {
        setError(res.status === 403 ? "You do not have permission to activate a brand." : "Couldn't activate this preset. Please try again.");
        return;
      }
      setPending(null);
      router.refresh();
    } catch {
      setError("Couldn't activate this preset. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (presets.length === 0) {
    return (
      <Card title="Brand presets">
        <div className="pad">
          <p style={{ color: "var(--mut)", margin: 0 }}>No presets are available.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Brand presets">
      <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {presets.map((p) => {
          const isActive = Boolean(activeHint && activeHint.toLowerCase() === p.colorPrimary.toLowerCase());
          return (
            <div
              key={p.code}
              style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{p.name}</strong>
                {isActive ? <StatusPill status="active" label="Active" /> : null}
              </div>
              {p.description ? (
                <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{p.description}</p>
              ) : null}
              <SwatchRow
                colors={[
                  { color: p.colorPrimary, label: "Primary" },
                  { color: p.colorSecondary, label: "Secondary" },
                  { color: p.colorAccent, label: "Accent" },
                ]}
              />
              {canActivate && !isActive ? (
                <button
                  type="button"
                  className="btn primary"
                  style={{ marginTop: 2, fontSize: 13 }}
                  aria-label={`Activate the ${p.name} brand preset`}
                  onClick={() => { setError(""); setPending(p.code); }}
                >
                  Activate
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <ConfirmDialog
        open={pending !== null}
        title="Activate brand preset?"
        description="This changes the colours and logo every user in your organisation sees. The change is audited."
        confirmLabel="Activate"
        busy={busy}
        errorMessage={error}
        onConfirm={() => { if (pending) void activate(pending); }}
        onCancel={() => { if (!busy) { setPending(null); setError(""); } }}
      />
    </Card>
  );
}
