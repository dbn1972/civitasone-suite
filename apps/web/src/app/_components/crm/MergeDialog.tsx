"use client";
/**
 * MergeDialog — DQ-002. Reusable merge flow for contacts / leads / accounts.
 *
 * The clerk picks a primary (kept) and a duplicate (merged away), previews the
 * fields side by side, then confirms via ConfirmDialog. Merge is IRREVERSIBLE,
 * so the confirm step is required. The API returns 202 (async), so on success
 * we tell the clerk it was "submitted", not "done".
 */
import { useMemo, useState, useId } from "react";
import { ConfirmDialog } from "../ds/ConfirmDialog";
import { mergeEntities, type DqEntity } from "@/lib/crm/dataQuality";

export interface MergeOption {
  id: string;
  label: string;
  /** Optional extra fields shown in the side-by-side preview. */
  fields?: Record<string, string | null | undefined>;
}

const ENTITY_NOUN: Record<DqEntity, string> = {
  contacts: "contact",
  leads: "lead",
  accounts: "account",
};

export function MergeDialog({
  entity,
  options,
  open,
  onClose,
  onMerged,
}: {
  entity: DqEntity;
  options: MergeOption[];
  open: boolean;
  onClose: () => void;
  onMerged?: () => void;
}) {
  const noun = ENTITY_NOUN[entity];
  const [primaryId, setPrimaryId] = useState("");
  const [duplicateId, setDuplicateId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const primaryLabelId = useId();
  const duplicateLabelId = useId();
  const sameSelection = primaryId !== "" && primaryId === duplicateId;

  const primary = useMemo(() => options.find((o) => o.id === primaryId), [options, primaryId]);
  const duplicate = useMemo(() => options.find((o) => o.id === duplicateId), [options, duplicateId]);

  const fieldKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const rec of [primary, duplicate]) {
      if (rec?.fields) for (const k of Object.keys(rec.fields)) keys.add(k);
    }
    return Array.from(keys);
  }, [primary, duplicate]);

  function reset() {
    setPrimaryId("");
    setDuplicateId("");
    setConfirmOpen(false);
    setBusy(false);
    setError("");
    setDone(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function doMerge() {
    setBusy(true);
    setError("");
    try {
      await mergeEntities(entity, primaryId, duplicateId);
      setDone(true);
      setConfirmOpen(false);
      onMerged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not merge this ${noun}.`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="pad" style={{ maxWidth: 720 }}>
        <h4 style={{ marginTop: 0 }}>Merge duplicate {noun}s</h4>
        {done ? (
          <>
            <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857" }}>
              Merge submitted. It completes in the background; the list updates once processing finishes.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" className="btn ghost" onClick={reset}>Merge another</button>
              <button type="button" className="btn primary" onClick={close}>Done</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
              Choose the record to keep (primary) and the duplicate to merge into it. This cannot be undone.
            </p>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
              <div>
                <label id={primaryLabelId} htmlFor={`${primaryLabelId}-sel`} style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 }}>
                  Keep (primary)
                </label>
                <select
                  id={`${primaryLabelId}-sel`}
                  value={primaryId}
                  aria-required="true"
                  onChange={(e) => setPrimaryId(e.target.value)}
                  style={{ width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" }}
                >
                  <option value="">Select a {noun}…</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label id={duplicateLabelId} htmlFor={`${duplicateLabelId}-sel`} style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 }}>
                  Merge away (duplicate)
                </label>
                <select
                  id={`${duplicateLabelId}-sel`}
                  value={duplicateId}
                  aria-required="true"
                  onChange={(e) => setDuplicateId(e.target.value)}
                  style={{ width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" }}
                >
                  <option value="">Select a {noun}…</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {sameSelection ? (
              <p role="alert" style={{ fontSize: 13, color: "#b42318", marginTop: 8 }}>
                Primary and duplicate must be different records.
              </p>
            ) : null}

            {primary && duplicate && !sameSelection && fieldKeys.length > 0 ? (
              <table className="tbl" style={{ marginTop: 14 }}>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Keep — {primary.label}</th>
                    <th>Merge away — {duplicate.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {fieldKeys.map((k) => {
                    const pv = primary.fields?.[k];
                    const dv = duplicate.fields?.[k];
                    const differ = (pv ?? "") !== (dv ?? "");
                    return (
                      <tr key={k}>
                        <td style={{ fontWeight: 600 }}>{k}</td>
                        <td>{pv || "—"}</td>
                        <td style={differ ? { color: "#b45309" } : undefined}>{dv || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}

            {error ? (
              <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 8 }}>{error}</p>
            ) : null}

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                className="btn primary"
                disabled={!primaryId || !duplicateId || sameSelection}
                onClick={() => setConfirmOpen(true)}
              >
                Review &amp; merge
              </button>
              <button type="button" className="btn ghost" onClick={close}>Cancel</button>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        danger
        title={`Merge this ${noun}? This cannot be undone`}
        description={
          <>
            <strong>{duplicate?.label}</strong> will be merged into <strong>{primary?.label}</strong>. The
            duplicate record is removed and its data folds into the primary. This is irreversible.
          </>
        }
        confirmLabel="Merge permanently"
        cancelLabel="Cancel"
        busy={busy}
        errorMessage={error || undefined}
        onConfirm={() => void doMerge()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
