"use client";

import { useMemo, useState } from "react";
import { Button, Card, ConfirmDialog, EmptyState, StatusPill } from "@/app/_components/ds";
import type { ConfigEntry, PresetName } from "../_data/types";
import { PRESET_NAMES } from "../_data/types";
import { humanize } from "../_data/format";
import {
  DEFAULT_DISPOSAL_DAYS,
  ENUM_NAMESPACES,
  PRESET_LABELS,
  SLA_KEY,
  SLA_NS,
  encodeDisposalDays,
  readDisposalDays,
  type EnumNamespace,
} from "../_data/policy";
import {
  applyPreset,
  deactivateConfig,
  fetchConfigNamespace,
  setConfig,
} from "../_data/client";

const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};
const fieldStyle: React.CSSProperties = {
  padding: 8,
  borderRadius: 8,
  border: "1px solid var(--line)",
  fontSize: 13.5,
};

const ALL_NS = [...ENUM_NAMESPACES.map((n) => n.namespace), SLA_NS];

export function AdminConfig({
  initialEntries,
  initialSources,
  allError = false,
}: {
  initialEntries: ConfigEntry[];
  /** Per-namespace load health (GAP-COURT-ADMIN-04). */
  initialSources: Record<string, "api" | "error">;
  allError?: boolean;
}) {
  const [entries, setEntries] = useState<ConfigEntry[]>(initialEntries);
  const [sources, setSources] = useState<Record<string, "api" | "error">>(initialSources);
  const [presetBusy, setPresetBusy] = useState<PresetName | null>(null);
  const [pendingPreset, setPendingPreset] = useState<PresetName | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byNamespace = useMemo(() => {
    const m = new Map<string, ConfigEntry[]>();
    for (const e of entries) {
      const list = m.get(e.namespace) ?? [];
      list.push(e);
      m.set(e.namespace, list);
    }
    return m;
  }, [entries]);

  /** Reload a single namespace, clearing/raising its per-card error. */
  async function reloadNamespace(ns: string) {
    try {
      const rows = await fetchConfigNamespace(ns);
      setEntries((prev) => [...prev.filter((e) => e.namespace !== ns), ...rows]);
      setSources((prev) => ({ ...prev, [ns]: "api" }));
    } catch {
      setSources((prev) => ({ ...prev, [ns]: "error" }));
    }
  }

  async function reloadAll() {
    const results = await Promise.all(
      ALL_NS.map(async (ns) => {
        try {
          return { ns, rows: await fetchConfigNamespace(ns), ok: true as const };
        } catch {
          return { ns, rows: [] as ConfigEntry[], ok: false as const };
        }
      }),
    );
    setEntries(results.flatMap((r) => r.rows));
    setSources(Object.fromEntries(results.map((r) => [r.ns, r.ok ? "api" : "error"])) as Record<string, "api" | "error">);
  }

  function ok(msg: string) {
    setToast(msg);
    setError(null);
  }
  function bad(err: unknown, fallback: string) {
    setError(err instanceof Error ? err.message : fallback);
    setToast(null);
  }

  async function confirmApplyPreset() {
    const preset = pendingPreset;
    if (!preset) return;
    setPresetBusy(preset);
    setError(null);
    setToast(null);
    try {
      await applyPreset(preset);
      ok(`Applied the ${PRESET_LABELS[preset] ?? preset} preset.`);
      setPendingPreset(null);
      await reloadAll();
    } catch (err) {
      bad(err, "Could not apply the preset.");
    } finally {
      setPresetBusy(null);
    }
  }

  const slaEntry = (byNamespace.get(SLA_NS) ?? []).find((e) => e.configKey === SLA_KEY);

  return (
    <>
      {toast && (
        <div className="alert" role="status" style={{ borderColor: "var(--primary)" }}>
          ✓ {toast}
        </div>
      )}
      {error && (
        <div className="alert" role="alert" style={{ borderColor: "#fca5a5", color: "var(--bad)" }}>
          ⚠ {error}
        </div>
      )}

      <Card title="Vertical presets" padding>
        <p style={{ fontSize: 13.5, color: "var(--ink2)", marginBottom: 12 }}>
          Seed the value lists for a court vertical in one click. Presets upsert the case, court and
          order types below; you can then add or retire individual values.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {PRESET_NAMES.map((p) => (
            <Button
              key={p}
              variant="ghost"
              disabled={presetBusy !== null}
              onClick={() => setPendingPreset(p)}
            >
              {presetBusy === p ? "Applying…" : (PRESET_LABELS[p] ?? p)}
            </Button>
          ))}
        </div>
      </Card>

      {/* GAP-COURT-ADMIN-01: a preset overwrites tenant-wide value lists; confirm first. */}
      <ConfirmDialog
        open={pendingPreset !== null}
        danger
        title="Apply vertical preset?"
        confirmLabel="Apply preset"
        description={
          pendingPreset ? (
            <>
              <p>
                Applying the <strong>{PRESET_LABELS[pendingPreset] ?? pendingPreset}</strong> preset
                upserts this tenant&rsquo;s <strong>case types</strong>, <strong>court types</strong> and{" "}
                <strong>order types</strong> for everyone. Existing values are kept; the preset&rsquo;s
                values are added or re-activated.
              </p>
              <p style={{ marginTop: 8 }}>You can still add or retire individual values afterwards.</p>
            </>
          ) : null
        }
        busy={presetBusy !== null}
        onConfirm={() => void confirmApplyPreset()}
        onCancel={() => setPendingPreset(null)}
      />

      {allError && entries.length === 0 && (
        <Card padding>
          <EmptyState
            icon="⚙️"
            title="Configuration couldn’t be loaded"
            message="Live configuration couldn’t be reached for any list. Retry each card below once connectivity returns — editing is disabled until a list loads so you can’t accidentally save over real config."
          />
        </Card>
      )}

      <SlaEditor
        entry={slaEntry}
        errored={sources[SLA_NS] === "error"}
        onOk={ok}
        onError={bad}
        onReload={() => reloadNamespace(SLA_NS)}
      />

      {ENUM_NAMESPACES.map((ns) => (
        <EnumEditor
          key={ns.namespace}
          ns={ns}
          entries={byNamespace.get(ns.namespace) ?? []}
          errored={sources[ns.namespace] === "error"}
          onOk={ok}
          onError={bad}
          onReload={() => reloadNamespace(ns.namespace)}
        />
      ))}
    </>
  );
}

// ─── Disposal SLA (numeric namespace) ────────────────────────────────────────

function SlaEditor({
  entry,
  errored,
  onOk,
  onError,
  onReload,
}: {
  entry: ConfigEntry | undefined;
  errored: boolean;
  onOk: (msg: string) => void;
  onError: (err: unknown, fallback: string) => void;
  onReload: () => Promise<void>;
}) {
  const current = entry ? readDisposalDays(entry.value) : DEFAULT_DISPOSAL_DAYS;
  const [draft, setDraft] = useState(String(current));
  const [busy, setBusy] = useState(false);

  async function save() {
    const days = Number(draft);
    if (!Number.isInteger(days) || days <= 0) return;
    setBusy(true);
    try {
      await setConfig({
        namespace: SLA_NS,
        configKey: SLA_KEY,
        value: encodeDisposalDays(days),
        label: "Target disposal window",
        ...(entry ? { expectedVersion: entry.version } : {}),
      });
      onOk("Saved the disposal SLA.");
      await onReload();
    } catch (err) {
      onError(err, "Could not save the disposal SLA.");
    } finally {
      setBusy(false);
    }
  }

  if (errored) {
    return (
      <Card title="Disposal SLA" padding>
        <NamespaceError onReload={onReload} />
      </Card>
    );
  }

  return (
    <Card title="Disposal SLA" padding>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Target disposal window</div>
          <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>
            Calendar days from filing within which a matter should be disposed. Advisory — it sets
            the SLA target date, it never blocks registration.
          </div>
          <div style={{ marginTop: 4 }}>
            {entry ? (
              <StatusPill status="active" label={`v${entry.version}`} />
            ) : (
              <StatusPill status="draft" label={`Default · ${DEFAULT_DISPOSAL_DAYS} days`} />
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="number"
            aria-label="Disposal SLA days"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ ...fieldStyle, width: 92, ...mono, textAlign: "right" }}
          />
          <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>days</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || draft.trim() === "" || Number(draft) === current}
            onClick={() => void save()}
          >
            {busy ? "…" : "Save"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ─── Per-card error state (GAP-COURT-ADMIN-04) ───────────────────────────────

function NamespaceError({ onReload }: { onReload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div role="alert" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13.5, color: "var(--ink2)" }}>
        Could not load this list. Its values are hidden rather than falling back to defaults, so you
        can&rsquo;t accidentally save over real configuration. Adding and retiring are disabled until
        it loads.
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onReload().finally(() => setBusy(false));
        }}
      >
        {busy ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}

// ─── Enumeration namespace editor ────────────────────────────────────────────

function EnumEditor({
  ns,
  entries,
  errored,
  onOk,
  onError,
  onReload,
}: {
  ns: EnumNamespace;
  entries: ConfigEntry[];
  errored: boolean;
  onOk: (msg: string) => void;
  onError: (err: unknown, fallback: string) => void;
  onReload: () => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [keepDefaults, setKeepDefaults] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [pendingRetire, setPendingRetire] = useState<ConfigEntry | null>(null);

  const active = entries.filter((e) => e.active);
  const configured = active.length > 0;
  const isLastActive = active.length === 1;

  async function add() {
    const configKey = key.trim();
    if (!configKey) return;
    setBusy(true);
    try {
      // GAP-COURT-ADMIN-05: when seeding the FIRST value into an unconfigured
      // namespace that has module defaults, optionally also persist those
      // defaults so they don't silently stop applying.
      if (!configured && keepDefaults && ns.defaults.length > 0) {
        for (const d of ns.defaults) {
          if (d === configKey) continue;
          await setConfig({ namespace: ns.namespace, configKey: d, value: { allowed: true }, label: humanize(d) });
        }
      }
      await setConfig({
        namespace: ns.namespace,
        configKey,
        value: { allowed: true },
        // GAP-COURT-ADMIN-03: label is never blank — auto-fill from the key.
        label: label.trim() || humanize(configKey),
      });
      setKey("");
      setLabel("");
      setKeepDefaults(false);
      onOk(`Added “${configKey}” to ${ns.title}.`);
      await onReload();
    } catch (err) {
      onError(err, "Could not add the value.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRetire() {
    const entry = pendingRetire;
    if (!entry) return;
    setRowBusy(entry.id);
    try {
      await deactivateConfig(entry.id, entry.version);
      onOk(`Retired “${entry.configKey}”.`);
      setPendingRetire(null);
      await onReload();
    } catch (err) {
      onError(err, "Could not retire the value.");
    } finally {
      setRowBusy(null);
    }
  }

  // Preview of the effective list after adding this key to an unconfigured ns.
  const effectivePreview = useMemo(() => {
    const k = key.trim();
    if (!k || configured) return [];
    const base = keepDefaults ? [...ns.defaults] : [];
    return Array.from(new Set([...base, k]));
  }, [key, configured, keepDefaults, ns.defaults]);

  if (errored) {
    return (
      <Card title={ns.title} padding>
        <NamespaceError onReload={onReload} />
      </Card>
    );
  }

  return (
    <Card title={ns.title} padding>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 10 }}>{ns.description}</p>

      {configured ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {active.map((e) => (
            <span
              key={e.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                borderRadius: 999,
                border: "1px solid var(--line)",
                fontSize: 12.5,
              }}
            >
              <span style={{ fontWeight: 600 }}>{e.label ?? humanize(e.configKey)}</span>
              <span style={{ ...mono, color: "var(--ink2)" }}>{e.configKey}</span>
              <Button
                aria-label={`Retire ${e.configKey}`}
                title="Retire this value"
                variant="ghost"
                size="sm"
                disabled={rowBusy === e.id}
                onClick={() => setPendingRetire(e)}
                style={{ padding: "0 6px", lineHeight: 1.4 }}
              >
                {rowBusy === e.id ? "…" : "✕"}
              </Button>
            </span>
          ))}
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 6 }}>
            {ns.defaults.length > 0
              ? "No values configured — the built-in module defaults apply:"
              : "No values configured yet. Add one below, or seed a vertical preset."}
          </div>
          {ns.defaults.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {/* GAP-COURT-ADMIN-03: show humanized labels, not raw snake_case. */}
              {ns.defaults.map((d) => (
                <StatusPill key={d} status="draft" label={humanize(d)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* GAP-COURT-ADMIN-05: warn that configuring the first value drops the defaults. */}
      {!configured && ns.defaults.length > 0 && key.trim() !== "" && (
        <div
          role="status"
          style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 10, border: "1px solid var(--warn, #f59e0b)", borderRadius: 8, padding: 8 }}
        >
          <div>
            Adding this makes <strong>only your configured values</strong> valid — the defaults{" "}
            {ns.defaults.map((d) => humanize(d)).join(", ")} will stop applying.
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6 }}>
            <input type="checkbox" checked={keepDefaults} onChange={(e) => setKeepDefaults(e.target.checked)} />
            Also keep the defaults (adds them as configured values)
          </label>
          {effectivePreview.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Effective list after change</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {effectivePreview.map((v) => (
                  <StatusPill key={v} status="active" label={humanize(v)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input
          aria-label={`New ${ns.title} key`}
          placeholder="value key (e.g. interim)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          style={{ ...fieldStyle, ...mono, flex: "1 1 180px" }}
        />
        <input
          aria-label={`New ${ns.title} label`}
          placeholder="label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={{ ...fieldStyle, flex: "1 1 180px" }}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={busy || key.trim() === ""}
          onClick={() => void add()}
        >
          {busy ? "Adding…" : "Add value"}
        </Button>
      </div>

      {/* GAP-COURT-ADMIN-02: confirm retire; warn when retiring the last value. */}
      <ConfirmDialog
        open={pendingRetire !== null}
        danger
        title={`Retire “${pendingRetire?.configKey ?? ""}”?`}
        confirmLabel="Retire value"
        description={
          <>
            <p>
              Retiring removes this value from the active {ns.title.toLowerCase()} list. It is
              reversible — you can re-add the key later.
            </p>
            {isLastActive && ns.defaults.length > 0 && (
              <p style={{ marginTop: 8 }}>
                <strong>This is the last active value.</strong> Once retired, the namespace falls
                back to the built-in module defaults ({ns.defaults.map((d) => humanize(d)).join(", ")}).
              </p>
            )}
            {isLastActive && ns.defaults.length === 0 && (
              <p style={{ marginTop: 8 }}>
                <strong>This is the last active value</strong>, and this namespace has no built-in
                defaults — the list will be empty until you add a value or seed a preset.
              </p>
            )}
          </>
        }
        busy={rowBusy === pendingRetire?.id}
        onConfirm={() => void confirmRetire()}
        onCancel={() => setPendingRetire(null)}
      />
    </Card>
  );
}
