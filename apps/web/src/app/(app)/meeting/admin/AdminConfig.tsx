"use client";

import { useMemo, useState } from "react";
import { Card, ConfirmDialog, EmptyState, StatusPill } from "@/app/_components/ds";
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

/** GAP-MEETING-ADMIN-06: always-visible allowed-range helper text for a number field. */
function rangeHint(field: PolicyField): string {
  if (field.min === undefined && field.max === undefined) return "";
  const unit = field.unit ? ` ${field.unit}` : "";
  return `Allowed: ${field.min ?? 0}–${field.max ?? "∞"}${unit}`;
}

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
  // GAP-MEETING-ADMIN-01: a preset overwrites tenant governance — confirm first.
  const [pendingPreset, setPendingPreset] = useState<PresetName | null>(null);
  const [presetErr, setPresetErr] = useState<string | undefined>(undefined);
  // GAP-MEETING-ADMIN-03/04: confirm turning a committee type Off.
  const [pendingToggleOff, setPendingToggleOff] = useState<PolicyField | null>(null);
  const [toggleErr, setToggleErr] = useState<string | undefined>(undefined);

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
    setPresetErr(undefined);
    try {
      await applyPreset(preset);
      setToast(`Applied the ${PRESET_LABELS[preset]} preset.`);
      setPendingPreset(null);
      await reload();
    } catch (err) {
      setPresetErr(err instanceof Error ? err.message : "Could not apply the preset.");
    } finally {
      setPresetBusy(null);
    }
  }

  // Count of policy values a preset will overwrite (every known policy knob +
  // committee type), used in the confirmation copy.
  const overwriteCount = POLICY_GROUPS.reduce((n, g) => n + g.fields.length, 0);

  /** Committee-type fields and how many are currently enabled, for ADMIN-04. */
  const committeeTypeFields = POLICY_GROUPS.flatMap((g) =>
    g.fields.filter((f) => f.namespace === COMMITTEE_TYPES_NS),
  );
  function enabledCommitteeTypeCount(): number {
    return committeeTypeFields.filter((f) =>
      readBooleanValue(byKey.get(keyOf(f.namespace, f.configKey))?.value, f),
    ).length;
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
              onClick={() => {
                setPresetErr(undefined);
                setPendingPreset(p);
              }}
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
                      role="switch"
                      aria-checked={current}
                      aria-label={field.label}
                      className={current ? "btn primary" : "btn ghost"}
                      disabled={busy}
                      onClick={() => {
                        if (current && field.namespace === COMMITTEE_TYPES_NS) {
                          // GAP-MEETING-ADMIN-03/04: turning a committee type OFF
                          // changes tenant governance — confirm, and warn when
                          // it's the last one enabled (all-off = all permitted).
                          setToggleErr(undefined);
                          setPendingToggleOff(field);
                        } else {
                          void save(field, encodeBooleanValue(field.namespace, !current));
                        }
                      }}
                    >
                      {busy ? "…" : current ? "On" : "Off"}
                    </button>
                  </div>
                );
              }

              const currentNum =
                typeof entry?.value === "number" ? entry.value : (field.default as number);
              const draft = drafts[k] ?? String(currentNum);
              const draftNum = Number(draft);
              const outOfRange =
                draft.trim() !== "" &&
                Number.isFinite(draftNum) &&
                ((field.min !== undefined && draftNum < field.min) ||
                  (field.max !== undefined && draftNum > field.max));
              const invalid = draft.trim() === "" || !Number.isFinite(draftNum) || outOfRange;
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
                    <div>
                      <input
                        type="number"
                        aria-label={field.label}
                        aria-invalid={outOfRange || undefined}
                        aria-describedby={`${k}-range`}
                        value={draft}
                        min={field.min}
                        max={field.max}
                        onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
                        style={{
                          width: 92,
                          padding: 8,
                          borderRadius: 8,
                          border: `1px solid ${outOfRange ? "var(--bad)" : "var(--line)"}`,
                          ...monoStyle,
                          textAlign: "end",
                        }}
                      />
                      {/* GAP-MEETING-ADMIN-06: show the allowed range ALWAYS
                          (before typing), and a full-sentence error when the
                          value is out of range. */}
                      <div
                        id={`${k}-range`}
                        style={{
                          fontSize: 11,
                          color: outOfRange ? "var(--bad)" : "var(--ink2)",
                          marginTop: 3,
                          textAlign: "end",
                        }}
                      >
                        {outOfRange
                          ? `Enter a value between ${field.min} and ${field.max}${field.unit ? " " + field.unit : ""}.`
                          : rangeHint(field)}
                      </div>
                    </div>
                    {field.unit && (
                      <span style={{ fontSize: 12.5, color: "var(--ink2)", minWidth: 52 }}>
                        {field.unit}
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={busy || invalid || draftNum === currentNum}
                      onClick={() => void save(field, draftNum)}
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

      <ConfirmDialog
        open={pendingPreset !== null}
        title={pendingPreset ? `Apply the ${PRESET_LABELS[pendingPreset]} preset?` : "Apply preset?"}
        description={`This overwrites all ${overwriteCount} tenant policy values below with the preset's baseline — agenda, minutes, escalation and committee-type settings. Your current tuned values will be replaced. This can't be undone.`}
        confirmLabel="Overwrite and apply"
        danger
        busy={presetBusy !== null}
        errorMessage={presetErr}
        onConfirm={() => {
          if (pendingPreset) void onApplyPreset(pendingPreset);
        }}
        onCancel={() => {
          if (presetBusy === null) setPendingPreset(null);
        }}
      />

      <ConfirmDialog
        open={pendingToggleOff !== null}
        title={pendingToggleOff ? `Turn off “${pendingToggleOff.label}”?` : "Turn off committee type?"}
        description={
          enabledCommitteeTypeCount() <= 1
            ? "This is the last enabled committee type. With none enabled, the engine permits EVERY committee type by default — the opposite of restricting them. Turn one on explicitly if you mean to limit the permitted types."
            : "This changes which committee types this tenant may constitute. Members won't be able to constitute a committee of this type."
        }
        confirmLabel="Turn off"
        danger
        busy={busyKey !== null}
        errorMessage={toggleErr}
        onConfirm={() => {
          if (!pendingToggleOff) return;
          const f = pendingToggleOff;
          setPendingToggleOff(null);
          void save(f, encodeBooleanValue(f.namespace, false));
        }}
        onCancel={() => {
          if (busyKey === null) setPendingToggleOff(null);
        }}
      />
    </>
  );
}
