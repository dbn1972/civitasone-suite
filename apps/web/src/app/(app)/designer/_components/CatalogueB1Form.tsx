"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import type { StatutoryReference } from "../_data/designerApi";
import { updateServiceDefinition } from "../_data/designerApi";
import { patternChangeImpact, SERVICE_PATTERN_OPTIONS } from "../_data/designerConstants";

const CHANNEL_OPTIONS = [
  { id: "portal", label: "Portal" },
  { id: "mobile", label: "Mobile" },
  { id: "counter", label: "Counter / CSC" },
  { id: "assisted", label: "Assisted" },
] as const;

export interface CatalogueB1Values {
  name: string;
  serviceKey: string;
  ownerDepartment: string;
  slaDays: number | "";
  channels: string[];
  statutoryReferences: StatutoryReference[];
  servicePattern: string;
}

interface Props {
  definitionId: string;
  initial: CatalogueB1Values;
  onSaveState?: (state: "saving" | "saved" | "offline") => void;
  onPatternChange?: (pattern: string) => void;
}

export function CatalogueB1Form({ definitionId, initial, onSaveState, onPatternChange }: Props) {
  const [values, setValues] = useState(initial);
  const [pendingPattern, setPendingPattern] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(values);
  latest.current = values;

  const persist = useCallback(async (patch: Partial<CatalogueB1Values>) => {
    onSaveState?.("saving");
    try {
      await updateServiceDefinition(definitionId, {
        name: patch.name,
        serviceKey: patch.serviceKey,
        ownerDepartment: patch.ownerDepartment || undefined,
        servicePattern: patch.servicePattern,
        slaDays: patch.slaDays === "" ? undefined : patch.slaDays,
        channels: patch.channels,
        statutoryReferences: patch.statutoryReferences,
      });
      onSaveState?.("saved");
    } catch {
      onSaveState?.("offline");
    }
  }, [definitionId, onSaveState]);

  const scheduleSave = useCallback((next: CatalogueB1Values) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persist(next); }, 2000);
  }, [persist]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setField = <K extends keyof CatalogueB1Values>(key: K, value: CatalogueB1Values[K]) => {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      scheduleSave(next);
      return next;
    });
  };

  const toggleChannel = (id: string) => {
    setValues((prev) => {
      const channels = prev.channels.includes(id)
        ? prev.channels.filter((c) => c !== id)
        : [...prev.channels, id];
      const next = { ...prev, channels };
      scheduleSave(next);
      return next;
    });
  };

  const addStatutory = () => {
    setField("statutoryReferences", [...values.statutoryReferences, { act: "" }]);
  };

  const updateStatutory = (idx: number, patch: Partial<StatutoryReference>) => {
    const statutoryReferences = values.statutoryReferences.map((row, i) =>
      i === idx ? { ...row, ...patch } : row,
    );
    setField("statutoryReferences", statutoryReferences);
  };

  const removeStatutory = (idx: number) => {
    setField("statutoryReferences", values.statutoryReferences.filter((_, i) => i !== idx));
  };

  const showCertWarning = useMemo(
    () => values.servicePattern === "certificate" && values.statutoryReferences.every((r) => !r.act.trim()),
    [values.servicePattern, values.statutoryReferences],
  );

  const patternImpact = pendingPattern
    ? patternChangeImpact(values.servicePattern, pendingPattern)
    : null;

  const applyPattern = (nextPattern: string) => {
    setValues((prev) => {
      const next = { ...prev, servicePattern: nextPattern };
      scheduleSave(next);
      return next;
    });
    onPatternChange?.(nextPattern);
    setPendingPattern(null);
  };

  const requestPatternChange = (nextPattern: string) => {
    if (nextPattern === values.servicePattern) return;
    setPendingPattern(nextPattern);
  };

  return (
    <>
      <ConfirmDialog
        open={pendingPattern !== null}
        title="Change Service Pattern?"
        description={
          patternImpact ? (
            <div style={{ display: "grid", gap: 8 }}>
              <p style={{ margin: 0 }}>
                Hidden block data is preserved — only the wizard steps change.
              </p>
              {patternImpact.hidden.length > 0 ? (
                <p style={{ margin: 0 }}>
                  These blocks will be hidden: {patternImpact.hidden.join(", ")}.
                </p>
              ) : null}
              {patternImpact.shown.length > 0 ? (
                <p style={{ margin: 0 }}>
                  These blocks will become available: {patternImpact.shown.join(", ")}.
                </p>
              ) : null}
            </div>
          ) : null
        }
        confirmLabel="Change pattern"
        onConfirm={() => { if (pendingPattern) applyPattern(pendingPattern); }}
        onCancel={() => setPendingPattern(null)}
      />
      <Card title="B1 — Catalogue & Identity" padding>
      <div style={{ display: "grid", gap: 16, maxWidth: 640 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Service Pattern</span>
          <select
            className="input"
            value={values.servicePattern}
            onChange={(e) => requestPatternChange(e.target.value)}
          >
            {SERVICE_PATTERN_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>
            Changing the pattern updates which composition blocks appear in the wizard.
          </span>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Service name</span>
          <input
            className="input"
            value={values.name}
            onChange={(e) => setField("name", e.target.value)}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Service key</span>
          <input
            className="input"
            value={values.serviceKey}
            onChange={(e) => setField("serviceKey", e.target.value)}
            aria-describedby="service-key-help"
          />
          <span id="service-key-help" style={{ fontSize: 12, color: "var(--mut)" }}>
            Used in URLs and integrations. Locked after first publish.
          </span>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Owning office</span>
          <input
            className="input"
            value={values.ownerDepartment}
            onChange={(e) => setField("ownerDepartment", e.target.value)}
            placeholder="Your department or office name"
          />
        </label>

        <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
          <legend style={{ marginBottom: 8 }}>Channels</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {CHANNEL_OPTIONS.map((ch) => (
              <label key={ch.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={values.channels.includes(ch.id)}
                  onChange={() => toggleChannel(ch.id)}
                />
                {ch.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label style={{ display: "grid", gap: 6 }}>
          <span>SLA days</span>
          <input
            className="input"
            type="number"
            min={0}
            value={values.slaDays}
            onChange={(e) => setField("slaDays", e.target.value === "" ? "" : Number(e.target.value))}
          />
          <span style={{ fontSize: 12, color: "var(--mut)" }}>Counted from submission.</span>
        </label>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontWeight: 600 }}>Statutory references</span>
            <button type="button" className="btn ghost" onClick={addStatutory}>Add reference</button>
          </div>
          {showCertWarning ? (
            <p style={{ margin: "0 0 12px", padding: "10px 12px", background: "var(--warn-bg)", border: "1px solid var(--warn-border)", borderRadius: "var(--r-sm)", fontSize: 13 }}>
              Certificates usually cite the empowering act — required before cross-tenant sharing.
            </p>
          ) : null}
          {values.statutoryReferences.length === 0 ? (
            <p style={{ margin: 0, color: "var(--mut)", fontSize: 13 }}>No statutory references yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {values.statutoryReferences.map((row, idx) => (
                <div key={idx} style={{ display: "grid", gap: 8, padding: 12, border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>
                  <input
                    className="input"
                    placeholder="Act name"
                    value={row.act}
                    onChange={(e) => updateStatutory(idx, { act: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Section (optional)"
                    value={row.section ?? ""}
                    onChange={(e) => updateStatutory(idx, { section: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Link (optional)"
                    value={row.url ?? ""}
                    onChange={(e) => updateStatutory(idx, { url: e.target.value })}
                  />
                  <button type="button" className="btn ghost" onClick={() => removeStatutory(idx)}>Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
    </>
  );
}
