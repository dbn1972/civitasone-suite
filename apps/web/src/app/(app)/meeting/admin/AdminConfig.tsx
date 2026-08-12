"use client";

import { useMemo, useState } from "react";
import { Card, EmptyState, StatusPill } from "@/app/_components/ds";
import type { ConfigEntry, PresetName } from "../_data/types";
import { PRESET_NAMES } from "../_data/types";
import {
  COMMITTEE_TYPES_NS,
  POLICY_GROUPS,
  POLICY_NS,
  encodeBooleanValue,
  readBooleanValue,
  type PolicyField,
} from "../_data/policy";
import { applyPreset, fetchConfigNamespace, setConfig } from "../_data/client";

const monoStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};

function keyOf(namespace: string, configKey: string): string {
  return `${namespace}::${configKey}`;
}

const PRESET_LABELS: Record<PresetName, string> = {
  "board-of-directors": "Board of directors",
  "statutory-committee": "Statutory committee",
  "municipal-council": "Municipal council",
};

export function AdminConfig({
  initialEntries,
  initialSource,
}: {
  initialEntries: ConfigEntry[];
  initialSource: "api" | "error";
}) {
  const [entries, setEntries] = useState<ConfigEntry[]>(initialEntries);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [presetBusy, setPresetBusy] = useState<PresetName | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const byKey = useMemo(() => {
    const m = new Map<string, ConfigEntry>();
    for (const e of entries) m.set(keyOf(e.namespace, e.configKey), e);
    return m;
  }, [entries]);

  async function reload() {
    try {
      const [policy, committeeTypes] = await Promise.all([
        fetchConfigNamespace(POLICY_NS),
        fetchConfigNamespace(COMMITTEE_TYPES_NS),
      ]);
      setEntries([...policy, ...committeeTypes]);
    } catch {
      /* keep current on reload failure */
    }
  }

  async function save(field: PolicyField, value: unknown) {
    const k = keyOf(field.namespace, field.configKey);
    setBusyKey(k);
    setError(null);
    setToast(null);
    const existing = byKey.get(k);
    try {
      await setConfig({
        namespace: field.namespace,
        configKey: field.configKey,
        value,
        label: field.label,
        ...(existing ? { expectedVersion: existing.version } : {}),
      });
      setToast(`Saved “${field.label}”.`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this setting.");
    } finally {
      setBusyKey(null);
    }
  }

  async function onApplyPreset(preset: PresetName) {
    setPresetBusy(preset);
    setError(null);
    setToast(null);
    try {
      await applyPreset(preset);
      setToast(`Applied the ${PRESET_LABELS[preset]} preset.`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply the preset.");
    } finally {
      setPresetBusy(null);
    }
  }

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

      <Card title="Governance presets" padding>
        <p style={{ fontSize: 13.5, color: "var(--ink2)", marginBottom: 12 }}>
          Seed a sensible baseline for your body type in one click. Presets upsert the policies
          below; you can then fine-tune any value.
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
              {presetBusy === p ? "Applying…" : PRESET_LABELS[p]}
            </button>
          ))}
        </div>
      </Card>

      {initialSource === "error" && entries.length === 0 && (
        <Card padding>
          <EmptyState
            icon="⚙️"
            title="Showing default policy"
            message="Live configuration couldn't be reached, so the engine defaults below are shown. Saving will still write to the config engine once connectivity returns."
          />
        </Card>
      )}

      {POLICY_GROUPS.map((group) => (
        <Card key={group.title} title={group.title} padding>
          <p style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 10 }}>
            {group.description}
          </p>
          <div style={{ display: "grid", gap: 2 }}>
            {group.fields.map((field) => {
              const k = keyOf(field.namespace, field.configKey);
              const entry = byKey.get(k);
              const isSet = entry !== undefined;
              const busy = busyKey === k;

              if (field.kind === "boolean") {
                const current = readBooleanValue(entry?.value, field);
                return (
                  <div
                    key={k}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 0",
                      borderBottom: "1px solid var(--line2)",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{field.label}</div>
                      <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>{field.help}</div>
                      <div style={{ marginTop: 4 }}>
                        {isSet ? (
                          <StatusPill status="active" label={`v${entry?.version}`} />
                        ) : (
                          <StatusPill status="draft" label="Default" />
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={current ? "btn primary" : "btn ghost"}
                      disabled={busy}
                      onClick={() => void save(field, encodeBooleanValue(field.namespace, !current))}
                    >
                      {busy ? "…" : current ? "On" : "Off"}
                    </button>
                  </div>
                );
              }

              const currentNum =
                typeof entry?.value === "number" ? entry.value : (field.default as number);
              const draft = drafts[k] ?? String(currentNum);
              return (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 0",
                    borderBottom: "1px solid var(--line2)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{field.label}</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>{field.help}</div>
                    <div style={{ marginTop: 4 }}>
                      {isSet ? (
                        <StatusPill status="active" label={`v${entry?.version}`} />
                      ) : (
                        <StatusPill
                          status="draft"
                          label={`Default · ${field.default}${field.unit ? " " + field.unit : ""}`}
                        />
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number"
                      aria-label={field.label}
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
                      style={{
                        width: 92,
                        padding: 8,
                        borderRadius: 8,
                        border: "1px solid var(--line)",
                        ...monoStyle,
                        textAlign: "right",
                      }}
                    />
                    {field.unit && (
                      <span style={{ fontSize: 12.5, color: "var(--ink2)", minWidth: 52 }}>
                        {field.unit}
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={busy || draft.trim() === "" || Number(draft) === currentNum}
                      onClick={() => void save(field, Number(draft))}
                    >
                      {busy ? "…" : "Save"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </>
  );
}
