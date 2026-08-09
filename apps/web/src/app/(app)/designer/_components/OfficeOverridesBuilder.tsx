"use client";

/**
 * FN-22 — Cross-Office Fee & Form Variants (B5).
 *
 * The panel states what an office may NOT vary, because that is the whole point
 * of the FN: fee, schedule, SLA and extra documents are local decisions; form,
 * workflow, pattern and head of account are not. If those were editable per
 * office, two offices would be running materially different services under one
 * pack version and one audit trail — a fork wearing a config costume.
 *
 * Fees are entered in rupees and stored in paise. Money is kept in minor units
 * end-to-end so no rounding is introduced between here and the ledger.
 */

import { useState } from "react";

export interface OfficeOverrideRow {
  officeId: string;
  feeFromMinor?: number;
  slaDays?: number;
  note?: string;
}

export function OfficeOverridesBuilder({
  value,
  offeringOfficeIds,
  onChange,
}: {
  value: OfficeOverrideRow[];
  offeringOfficeIds: string[];
  onChange: (next: OfficeOverrideRow[]) => void;
}) {
  const [draftOffice, setDraftOffice] = useState("");

  const update = (i: number, patch: Partial<OfficeOverrideRow>) =>
    onChange(value.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const used = new Set(value.map((v) => v.officeId));
  const available = offeringOfficeIds.filter((id) => !used.has(id));

  const add = () => {
    const officeId = draftOffice.trim();
    if (!officeId || used.has(officeId)) return;
    onChange([...value, { officeId }]);
    setDraftOffice("");
  };

  return (
    <section>
      <h2 style={h2}>Office variants</h2>
      <p style={muted}>
        Let a zone or ward charge a different fee or promise a different turnaround without
        forking the service. Every office keeps the same form, the same approval chain and the
        same head of account, so one published version still means one thing.
      </p>

      {offeringOfficeIds.length === 0 ? (
        <p style={{ ...hint, marginTop: 8 }}>
          This service is offered by every office under its owner. Add an office id below to give
          one of them different terms.
        </p>
      ) : null}

      {value.length === 0 ? (
        <p style={{ ...muted, fontStyle: "italic", marginTop: 12 }}>
          No variants. Every office runs the service exactly as published.
        </p>
      ) : null}

      <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 16 }}>
        {value.map((row, i) => (
          <li key={row.officeId} style={card}>
            <strong>{row.officeId}</strong>

            <label style={field}>
              <span style={labelText}>Fee (₹)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={row.feeFromMinor === undefined ? "" : row.feeFromMinor / 100}
                placeholder="Leave blank to use the published fee"
                onChange={(e) =>
                  update(i, {
                    feeFromMinor:
                      e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 100),
                  })
                }
                style={input}
              />
              <span style={hint}>A free zone is legitimate — enter 0 to charge nothing here.</span>
            </label>

            <label style={field}>
              <span style={labelText}>Service promise (days)</span>
              <input
                type="number"
                min={1}
                value={row.slaDays ?? ""}
                placeholder="Leave blank to use the published SLA"
                onChange={(e) =>
                  update(i, { slaDays: e.target.value === "" ? undefined : Number(e.target.value) })
                }
                style={input}
              />
            </label>

            <label style={field}>
              <span style={labelText}>Why this office differs</span>
              <input
                value={row.note ?? ""}
                placeholder="e.g. higher demand in the central zone"
                onChange={(e) => update(i, { note: e.target.value })}
                style={input}
              />
              <span style={hint}>For auditors. This is not shown to citizens.</span>
            </label>

            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: 12 }}
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            >
              Remove variant
            </button>
          </li>
        ))}
      </ul>

      <div style={{ ...card, marginTop: 16 }}>
        <label style={field}>
          <span style={labelText}>Add a variant for</span>
          {available.length > 0 ? (
            <select value={draftOffice} onChange={(e) => setDraftOffice(e.target.value)} style={input}>
              <option value="">Select an offering office…</option>
              {available.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          ) : (
            <input
              value={draftOffice}
              placeholder="Office id"
              onChange={(e) => setDraftOffice(e.target.value)}
              style={input}
            />
          )}
          <span style={hint}>
            The office must be one that offers this service, or publish is blocked — an override
            for an office that never runs the service is config that silently does nothing.
          </span>
        </label>
        <button type="button" className="btn" style={{ marginTop: 10 }} onClick={add} disabled={!draftOffice.trim()}>
          Add variant
        </button>
      </div>

      <p style={{ ...hint, marginTop: 16 }}>
        <strong>Not variable per office:</strong> the intake form, the approval chain, the service
        pattern and the head of account. Money must land in the account the published service
        declares.
      </p>
    </section>
  );
}

const h2: React.CSSProperties = { fontSize: 18, fontWeight: 600, margin: "0 0 6px" };
const muted: React.CSSProperties = { color: "var(--mut)", fontSize: 14, margin: 0 };
const card: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 8, padding: 16 };
const field: React.CSSProperties = { display: "grid", gap: 4, marginTop: 12 };
const labelText: React.CSSProperties = { fontSize: 13, fontWeight: 600 };
const hint: React.CSSProperties = { fontSize: 12, color: "var(--mut)" };
const input: React.CSSProperties = { padding: "8px 10px", borderRadius: 6, border: "1px solid var(--line)" };
