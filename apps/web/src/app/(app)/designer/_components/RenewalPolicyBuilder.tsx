"use client";

/**
 * FN-15 — Renewal lifecycle (B7, alongside Output & Issuance).
 *
 * Renewal only makes sense for an output that expires, so the validity model
 * drives the rest of the panel: with "never expires" there is nothing to renew,
 * and the renewal controls are hidden rather than shown-but-inert. Showing a
 * renewal window that can never open would imply a capability the service does
 * not have.
 *
 * The panel is explicit that expiry is terminal. Several licence regimes allow
 * late renewal with a penalty, but the BRD defines no grace period or penalty
 * basis, so the domain does not model one — and the designer is told that here
 * rather than discovering it from citizen complaints.
 */

export interface RenewalPolicyValue {
  renewable: boolean;
  renewalWindowDays: number;
  validityMode: "none" | "duration" | "fixed_date";
  validityYears?: number;
  validityFixedDate?: string;
}

const DEFAULTS: RenewalPolicyValue = {
  renewable: false,
  renewalWindowDays: 30,
  validityMode: "none",
};

export function RenewalPolicyBuilder({
  value,
  onChange,
}: {
  value: RenewalPolicyValue | null;
  onChange: (next: RenewalPolicyValue | null) => void;
}) {
  const v = value ?? DEFAULTS;
  const expires = v.validityMode !== "none";

  const set = (patch: Partial<RenewalPolicyValue>) => onChange({ ...v, ...patch });

  return (
    <section style={card}>
      <h3 style={h3}>Validity &amp; renewal</h3>

      <label style={field}>
        <span style={labelText}>How long the output stays valid</span>
        <select
          value={v.validityMode}
          onChange={(e) => {
            const mode = e.target.value as RenewalPolicyValue["validityMode"];
            // Nothing that never expires can be renewable; keep the two consistent
            // rather than storing a combination the domain would reject.
            set(mode === "none" ? { validityMode: mode, renewable: false } : { validityMode: mode });
          }}
          style={input}
        >
          <option value="none">Never expires</option>
          <option value="duration">Fixed period from issue</option>
          <option value="fixed_date">Same calendar date every time</option>
        </select>
      </label>

      {v.validityMode === "duration" ? (
        <label style={field}>
          <span style={labelText}>Valid for (years)</span>
          <input
            type="number"
            min={1}
            value={v.validityYears ?? ""}
            placeholder="1"
            onChange={(e) =>
              set({ validityYears: e.target.value === "" ? undefined : Number(e.target.value) })
            }
            style={input}
          />
          <span style={hint}>
            Counted in calendar years, so a licence issued on 29 February expires on 1 March.
          </span>
        </label>
      ) : null}

      {v.validityMode === "fixed_date" ? (
        <label style={field}>
          <span style={labelText}>Expires on</span>
          <input
            type="date"
            value={v.validityFixedDate ?? ""}
            onChange={(e) => set({ validityFixedDate: e.target.value })}
            style={input}
          />
          <span style={hint}>Used where a regime expires everything on a common date, e.g. 31 March.</span>
        </label>
      ) : null}

      {expires ? (
        <>
          <label style={{ ...inlineLabel, marginTop: 16 }}>
            <input
              type="checkbox"
              checked={v.renewable}
              onChange={(e) => set({ renewable: e.target.checked })}
            />
            Citizens can renew this instead of applying again
          </label>

          {v.renewable ? (
            <label style={field}>
              <span style={labelText}>Renewal opens (days before expiry)</span>
              <input
                type="number"
                min={0}
                value={v.renewalWindowDays}
                onChange={(e) => set({ renewalWindowDays: Number(e.target.value || 0) })}
                style={input}
              />
              <span style={hint}>
                0 means renewal opens on the expiry date itself. Renewal closes the day after
                expiry — after that a fresh application is required, because no grace period or
                late fee is defined for this platform.
              </span>
            </label>
          ) : null}
        </>
      ) : (
        <p style={{ ...hint, marginTop: 12 }}>
          Nothing to renew — this output has no expiry date.
        </p>
      )}

      {v.renewable ? (
        <p style={{ ...hint, marginTop: 12 }}>
          A renewal form is prefilled from the last application, except dates and uploaded
          documents. Those must be provided again so a renewal cannot silently reassert last
          year&apos;s declaration.
        </p>
      ) : null}
    </section>
  );
}

const card: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 8, padding: 16 };
const h3: React.CSSProperties = { fontSize: 15, fontWeight: 600, margin: "0 0 10px" };
const field: React.CSSProperties = { display: "grid", gap: 4, marginTop: 12 };
const labelText: React.CSSProperties = { fontSize: 13, fontWeight: 600 };
const hint: React.CSSProperties = { fontSize: 12, color: "var(--mut)" };
const input: React.CSSProperties = { padding: "8px 10px", borderRadius: 6, border: "1px solid var(--line)" };
const inlineLabel: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14 };
