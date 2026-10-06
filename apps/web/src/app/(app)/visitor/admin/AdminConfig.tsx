"use client";

import { useMemo, useState } from "react";
import { Card, ConfirmDialog, EmptyState, RefreshErrorState, StatusPill } from "@/app/_components/ds";
import type { ConfigEntry, PresetName } from "../_data/types";
import { PRESET_NAMES } from "../_data/types";
import {
  APPROVAL_NS,
  POLICY_NS,
  POLICY_GROUPS,
  encodeBooleanValue,
  readBooleanValue,
  type PolicyField,
} from "../_data/policy";
import { ConflictError, applyPreset, fetchConfigNamespace, setConfig } from "../_data/client";

const monoStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};

function keyOf(namespace: string, configKey: string): string {
  return `${namespace}::${configKey}`;
}

const PRESET_LABELS: Record<PresetName, string> = {
  secretariat: "Secretariat",
  "district-office": "District office",
  hospital: "Hospital",
};

type Source = "api" | "error";

export function AdminConfig({
  initialEntries,
  policySource,
  approvalSource,
}: {
  initialEntries: ConfigEntry[];
  policySource: Source;
  approvalSource: Source;
}) {
  const [entries, setEntries] = useState<ConfigEntry[]>(initialEntries);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [presetBusy, setPresetBusy] = useState<PresetName | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Draft values for number fields keyed by namespace::configKey.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // GAP-VISITOR-ADMIN-01/03: pending confirmation for a boolean toggle or a
  // preset application. The mutation only fires after the dialog is confirmed
  // (with a reason where required).
  const [confirmBool, setConfirmBool] = useState<null | { field: PolicyField; next: boolean }>(null);
  const [confirmPreset, setConfirmPreset] = useState<null | PresetName>(null);
  const [dialogErr, setDialogErr] = useState<string | undefined>(undefined);

  const byKey = useMemo(() => {
    const m = new Map<string, ConfigEntry>();
    for (const e of entries) m.set(keyOf(e.namespace, e.configKey), e);
    return m;
  }, [entries]);

  // GAP-VISITOR-ADMIN-05: per-namespace source. A field whose namespace failed
  // to load must not be editable (its "Default" pill would masquerade as a
  // live value and a Save could overwrite an unread tenant value).
  function sourceFor(namespace: string): Source {
    return namespace === APPROVAL_NS ? approvalSource : policySource;
  }

  async function reload() {
    try {
      // GAP-VISITOR-ADMIN-06: use POLICY_NS, not a hard-coded "visitor_policy".
      const [policy, approval] = await Promise.all([
        fetchConfigNamespace(POLICY_NS),
        fetchConfigNamespace(APPROVAL_NS),
      ]);
      setEntries([...policy, ...approval]);
      // GAP-VISITOR-ADMIN-04: clear all drafts after a successful reload so a
      // field never keeps a pre-preset/pre-save typed value.
      setDrafts({});
    } catch {
      /* keep current on reload failure */
    }
  }

  async function save(field: PolicyField, value: unknown, reason?: string) {
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
        ...(reason ? { reason } : {}),
      });
      setToast(`Saved “${field.label}”.`);
      // GAP-VISITOR-ADMIN-04: drop this field's draft after a successful save.
      setDrafts((d) => {
        const next = { ...d };
        delete next[k];
        return next;
      });
      await reload();
    } catch (err) {
      // GAP-VISITOR-ADMIN-06: a version conflict is distinct — reload + review.
      if (err instanceof ConflictError) {
        setError("Someone else changed this setting; values refreshed, please review.");
        await reload();
      } else {
        setError(err instanceof Error ? err.message : "Could not save this setting.");
      }
      throw err;
    } finally {
      setBusyKey(null);
    }
  }

  async function onApplyPreset(preset: PresetName, reason?: string) {
    setPresetBusy(preset);
    setError(null);
    setToast(null);
    try {
      await applyPreset(preset, reason);
      setToast(`Applied the ${PRESET_LABELS[preset]} preset.`);
      await reload();
    } catch (err) {
      if (err instanceof ConflictError) {
        setError("The configuration changed while applying the preset; values refreshed, please review.");
        await reload();
      } else {
        setError(err instanceof Error ? err.message : "Could not apply the preset.");
      }
      throw err;
    } finally {
      setPresetBusy(null);
    }
  }

  /**
   * GAP-VISITOR-ADMIN-03: a change requires a confirmation+reason when it is a
   * security-relevant flag — any APPROVAL_NS auto-approve toggle, or turning
   * anti-passback OFF.
   */
  function boolNeedsReason(field: PolicyField, next: boolean): boolean {
    if (field.namespace === APPROVAL_NS) return true;
    if (field.configKey === "turnstile.anti_passback_enabled" && next === false) return true;
    return false;
  }

  const bothFailed = policySource === "error" && approvalSource === "error";

  return (
    <>
      {toast && <div className="alert" role="status" style={{ borderColor: "var(--primary)" }}>✓ {toast}</div>}
      {error && <div className="alert" role="alert" style={{ borderColor: "#fca5a5", color: "var(--bad)" }}>⚠ {error}</div>}

      <Card title="Vertical presets" padding>
        <p style={{ fontSize: 13.5, color: "var(--ink2)", marginBottom: 12 }}>
          Seed a sensible baseline for your office type. Presets upsert the policies below (including DPDP retention and erasure SLA) — you’ll be asked to confirm and give a reason before anything changes.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {PRESET_NAMES.map((p) => (
            <button
              key={p}
              type="button"
              className="btn ghost"
              disabled={presetBusy !== null || bothFailed}
              onClick={() => { setDialogErr(undefined); setConfirmPreset(p); }}
            >
              {presetBusy === p ? "Applying…" : PRESET_LABELS[p]}
            </button>
          ))}
        </div>
      </Card>

      {bothFailed && (
        <Card padding>
          <EmptyState
            icon="⚙️"
            title="Showing default policy"
            message="Live configuration couldn't be reached, so the defaults below are shown. Saving is disabled until the configuration reloads."
          />
        </Card>
      )}

      {POLICY_GROUPS.map((group) => {
        // GAP-VISITOR-ADMIN-05: a group whose namespace failed to load shows a
        // retry state and disables its controls. (A group can mix namespaces,
        // but POLICY_GROUPS are single-namespace per group in practice.)
        const groupNs = group.fields[0]?.namespace ?? POLICY_NS;
        const groupFailed = sourceFor(groupNs) === "error";
        return (
          <Card key={group.title} title={group.title} padding>
            {groupFailed ? (
              <RefreshErrorState
                error={{
                  what: `We couldn't load the “${group.title}” settings.`,
                  next: "These controls are disabled until the configuration reloads. Try again.",
                  actions: ["retry"],
                }}
              />
            ) : (
              <div style={{ display: "grid", gap: 2 }}>
                {group.fields.map((field) => {
                  const k = keyOf(field.namespace, field.configKey);
                  const entry = byKey.get(k);
                  const isSet = entry !== undefined;
                  const busy = busyKey === k;

                  if (field.kind === "boolean") {
                    const current = readBooleanValue(entry?.value, field);
                    return (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line2)" }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{field.label}</div>
                          <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>{field.help}</div>
                          <div style={{ marginTop: 4 }}>
                            {isSet ? <StatusPill status="active" label={`v${entry?.version}`} /> : <StatusPill status="draft" label="Default" />}
                          </div>
                        </div>
                        {/* GAP-VISITOR-ADMIN-03: a switch (role="switch" + aria-checked)
                            so state and action are unambiguous; the change routes
                            through a confirm dialog (with a reason for sensitive flags). */}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={current}
                          aria-label={field.label}
                          className={current ? "btn primary" : "btn ghost"}
                          disabled={busy}
                          onClick={() => { setDialogErr(undefined); setConfirmBool({ field, next: !current }); }}
                        >
                          {busy ? "…" : current ? "On" : "Off"}
                        </button>
                      </div>
                    );
                  }

                  const currentNum = typeof entry?.value === "number" ? entry.value : (field.default as number);
                  const draft = drafts[k] ?? String(currentNum);
                  const draftNum = Number(draft);
                  const outOfRange =
                    draft.trim() !== "" &&
                    Number.isFinite(draftNum) &&
                    ((field.min !== undefined && draftNum < field.min) ||
                      (field.max !== undefined && draftNum > field.max));
                  const invalid = draft.trim() === "" || !Number.isFinite(draftNum) || outOfRange;
                  const dirty = draftNum !== currentNum;
                  return (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line2)" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{field.label}</div>
                        <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>{field.help}</div>
                        <div style={{ marginTop: 4 }}>
                          {isSet ? <StatusPill status="active" label={`v${entry?.version}`} /> : <StatusPill status="draft" label={`Default · ${field.default}${field.unit ? " " + field.unit : ""}`} />}
                          {/* GAP-VISITOR-ADMIN-04: unsaved-change hint. */}
                          {dirty && !invalid && <span style={{ marginLeft: 8, fontSize: 11.5, color: "#b45309" }}>unsaved change</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div>
                          <input
                            type="number"
                            aria-label={field.label}
                            aria-invalid={outOfRange || undefined}
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
                              textAlign: "right",
                            }}
                          />
                          {outOfRange && (
                            <div style={{ fontSize: 11, color: "var(--bad)", marginTop: 3, textAlign: "right" }}>
                              {field.min}–{field.max}
                            </div>
                          )}
                        </div>
                        {field.unit && <span style={{ fontSize: 12.5, color: "var(--ink2)", minWidth: 48 }}>{field.unit}</span>}
                        <button
                          type="button"
                          className="btn ghost sm"
                          disabled={busy || invalid || !dirty}
                          onClick={() => { void save(field, draftNum).catch(() => {}); }}
                        >
                          {busy ? "…" : "Save"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}

      {/* GAP-VISITOR-ADMIN-03: confirm a boolean toggle (reason for sensitive flags). */}
      <ConfirmDialog
        open={confirmBool !== null}
        title={confirmBool ? `${confirmBool.next ? "Enable" : "Disable"} “${confirmBool.field.label}”?` : ""}
        description={
          confirmBool
            ? boolNeedsReason(confirmBool.field, confirmBool.next)
              ? `This is a security-relevant policy. Record why you are turning it ${confirmBool.next ? "on" : "off"}.`
              : `Turn “${confirmBool.field.label}” ${confirmBool.next ? "on" : "off"}?`
            : ""
        }
        confirmLabel={confirmBool?.next ? "Turn on" : "Turn off"}
        danger={confirmBool ? boolNeedsReason(confirmBool.field, confirmBool.next) : false}
        requireReason={confirmBool ? boolNeedsReason(confirmBool.field, confirmBool.next) : false}
        reasonLabel="Reason for this change"
        busy={busyKey !== null}
        errorMessage={dialogErr}
        onConfirm={(reason) => {
          if (!confirmBool) return;
          const { field, next } = confirmBool;
          void save(field, encodeBooleanValue(field.namespace, next), reason)
            .then(() => setConfirmBool(null))
            .catch((e) => setDialogErr(e instanceof Error ? e.message : "Could not save."));
        }}
        onCancel={() => { if (busyKey === null) setConfirmBool(null); }}
      />

      {/* GAP-VISITOR-ADMIN-01: confirm a preset (diff + reason). */}
      <ConfirmDialog
        open={confirmPreset !== null}
        title={confirmPreset ? `Apply the ${PRESET_LABELS[confirmPreset]} preset?` : ""}
        description={
          "This upserts the whole policy below — including DPDP data-retention, erasure SLA, auto-approval and anti-passback — for the entire tenant. Record a reason; the change is audited."
        }
        confirmLabel="Apply preset"
        danger
        requireReason
        reasonLabel="Reason for applying this preset"
        busy={presetBusy !== null}
        errorMessage={dialogErr}
        onConfirm={(reason) => {
          if (!confirmPreset) return;
          void onApplyPreset(confirmPreset, reason)
            .then(() => setConfirmPreset(null))
            .catch((e) => setDialogErr(e instanceof Error ? e.message : "Could not apply the preset."));
        }}
        onCancel={() => { if (presetBusy === null) setConfirmPreset(null); }}
      />
    </>
  );
}
