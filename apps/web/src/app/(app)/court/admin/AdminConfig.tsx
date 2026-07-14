"use client";

import { useMemo, useState } from "react";
import { Card, EmptyState, StatusPill } from "@/app/_components/ds";
import type { ConfigEntry, PresetName } from "../_data/types";
import { PRESET_NAMES } from "../_data/types";
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
  initialSource,
}: {
  initialEntries: ConfigEntry[];
  initialSource: "api" | "error";
}) {
  const [entries, setEntries] = useState<ConfigEntry[]>(initialEntries);
  const [presetBusy, setPresetBusy] = useState<PresetName | null>(null);
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

  async function reload() {
    try {
      const all = await Promise.all(ALL_NS.map((ns) => fetchConfigNamespace(ns)));
      setEntries(all.flat());
    } catch {
      /* keep current on reload failure */
    }
  }

  function ok(msg: string) {
    setToast(msg);
    setError(null);
  }
  function bad(err: unknown, fallback: string) {
    setError(err instanceof Error ? err.message : fallback);
    setToast(null);
  }

  async function onApplyPreset(preset: PresetName) {
    setPresetBusy(preset);
    setError(null);
    setToast(null);
    try {
      await applyPreset(preset);
      ok(`Applied the ${PRESET_LABELS[preset] ?? preset} preset.`);
      await reload();
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
        <div className="alert" role="alert" style={{ borderColor: "#fca5a5", color: "#b91c1c" }}>
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
            <button
              key={p}
              type="button"
              className="btn ghost"
              disabled={presetBusy !== null}
              onClick={() => void onApplyPreset(p)}
            >
              {presetBusy === p ? "Applying…" : (PRESET_LABELS[p] ?? p)}
            </button>
          ))}
        </div>
      </Card>

      {initialSource === "error" && entries.length === 0 && (
        <Card padding>
          <EmptyState
            icon="⚙️"
            title="Showing built-in defaults"
            message="Live configuration couldn't be reached, so the module defaults below are shown. Saving will still write to the config engine once connectivity returns."
          />
        </Card>
      )}

      <SlaEditor entry={slaEntry} onOk={ok} onError={bad} onReload={reload} />

      {ENUM_NAMESPACES.map((ns) => (
        <EnumEditor
          key={ns.namespace}
          ns={ns}
          entries={byNamespace.get(ns.namespace) ?? []}
          onOk={ok}
          onError={bad}
          onReload={reload}
        />
      ))}
    </>
  );
}

// ─── Disposal SLA (numeric namespace) ────────────────────────────────────────

function SlaEditor({
  entry,
  onOk,
  onError,
  onReload,
}: {
  entry: ConfigEntry | undefined;
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
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy || draft.trim() === "" || Number(draft) === current}
            onClick={() => void save()}
          >
            {busy ? "…" : "Save"}
          </button>
        </div>
      </div>
    </Card>
  );
}

// ─── Enumeration namespace editor ────────────────────────────────────────────

function EnumEditor({
  ns,
  entries,
  onOk,
  onError,
  onReload,
}: {
  ns: EnumNamespace;
  entries: ConfigEntry[];
  onOk: (msg: string) => void;
  onError: (err: unknown, fallback: string) => void;
  onReload: () => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const active = entries.filter((e) => e.active);
  const configured = active.length > 0;

  async function add() {
    const configKey = key.trim();
    if (!configKey) return;
    setBusy(true);
    try {
      await setConfig({
        namespace: ns.namespace,
        configKey,
        value: { allowed: true },
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      setKey("");
      setLabel("");
      onOk(`Added “${configKey}” to ${ns.title}.`);
      await onReload();
    } catch (err) {
      onError(err, "Could not add the value.");
    } finally {
      setBusy(false);
    }
  }

  async function retire(entry: ConfigEntry) {
    setRowBusy(entry.id);
    try {
      await deactivateConfig(entry.id, entry.version);
      onOk(`Retired “${entry.configKey}”.`);
      await onReload();
    } catch (err) {
      onError(err, "Could not retire the value.");
    } finally {
      setRowBusy(null);
    }
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
              <span style={{ fontWeight: 600 }}>{e.label ?? e.configKey}</span>
              <span style={{ ...mono, color: "var(--ink2)" }}>{e.configKey}</span>
              <button
                type="button"
                aria-label={`Retire ${e.configKey}`}
                title="Retire this value"
                className="btn ghost sm"
                disabled={rowBusy === e.id}
                onClick={() => void retire(e)}
                style={{ padding: "0 6px", lineHeight: 1.4 }}
              >
                {rowBusy === e.id ? "…" : "✕"}
              </button>
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
              {ns.defaults.map((d) => (
                <StatusPill key={d} status="draft" label={d} />
              ))}
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
        <button
          type="button"
          className="btn primary sm"
          disabled={busy || key.trim() === ""}
          onClick={() => void add()}
        >
          {busy ? "Adding…" : "Add value"}
        </button>
      </div>
    </Card>
  );
}
