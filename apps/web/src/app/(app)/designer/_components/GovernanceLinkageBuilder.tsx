"use client";

/**
 * FN-27 (appeal path), FN-28 (RTI publication) and FN-18/FN-32 (locales) — B1.
 *
 * These are service-level governance metadata, which is why they sit in
 * Catalogue & Identity rather than in a block of their own: the BRD fixes the
 * 8-block model, and inventing a B9 would break a core concept of the Designer.
 *
 * Both toggles reveal a REQUIRED designation when switched on, and say why. The
 * publish gate refuses an appealable service with no appellate authority, and an
 * RTI-published service with no PIO; surfacing that at the point of the toggle
 * means the designer meets the rule while authoring instead of discovering it as
 * an error code at publish.
 */

export interface AppealLinkageValue {
  appealable: boolean;
  filingWindowDays?: number;
  appellateDesignationId?: string;
  appellateDesignationLabel?: string;
  statutoryReference?: string;
}

export interface RtiLinkageValue {
  published: boolean;
  pioDesignationId?: string;
  pioDesignationLabel?: string;
}

export function GovernanceLinkageBuilder({
  appeal,
  rti,
  locales,
  onAppealChange,
  onRtiChange,
  onLocalesChange,
}: {
  appeal: AppealLinkageValue | null;
  rti: RtiLinkageValue | null;
  locales: string[];
  onAppealChange: (next: AppealLinkageValue | null) => void;
  onRtiChange: (next: RtiLinkageValue | null) => void;
  onLocalesChange: (next: string[]) => void;
}) {
  const appealOn = appeal?.appealable ?? false;
  const rtiOn = rti?.published ?? false;

  return (
    <section style={{ display: "grid", gap: 24 }}>
      {/* ── FN-27 ── */}
      <div style={card}>
        <h3 style={h3}>Right of appeal</h3>
        <label style={inlineLabel}>
          <input
            type="checkbox"
            checked={appealOn}
            onChange={(e) =>
              onAppealChange(e.target.checked ? { ...(appeal ?? {}), appealable: true } : { appealable: false })
            }
          />
          A decision on this service can be appealed
        </label>

        {appealOn ? (
          <>
            <label style={field}>
              <span style={labelText}>Appellate authority (designation)</span>
              <input
                value={appeal?.appellateDesignationId ?? ""}
                placeholder="e.g. additional_commissioner"
                onChange={(e) => onAppealChange({ ...(appeal ?? { appealable: true }), appealable: true, appellateDesignationId: e.target.value })}
                style={input}
              />
              <span style={hint}>
                Required. A designation, not a named officer — an appeal right with nobody to
                hear it is a dead end for the citizen, so publish is blocked without one.
              </span>
            </label>

            <label style={field}>
              <span style={labelText}>Filing window (days)</span>
              <input
                type="number"
                min={1}
                value={appeal?.filingWindowDays ?? ""}
                placeholder="30"
                onChange={(e) =>
                  onAppealChange({
                    ...(appeal ?? { appealable: true }),
                    appealable: true,
                    filingWindowDays: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
                style={input}
              />
              <span style={hint}>Leave blank to use the statutory default of 30 days.</span>
            </label>

            <label style={field}>
              <span style={labelText}>Statutory reference</span>
              <input
                value={appeal?.statutoryReference ?? ""}
                placeholder="e.g. s.21, Municipal Act"
                onChange={(e) => onAppealChange({ ...(appeal ?? { appealable: true }), appealable: true, statutoryReference: e.target.value })}
                style={input}
              />
              <span style={hint}>Shown to the citizen so they can see where the right comes from.</span>
            </label>
          </>
        ) : (
          <p style={hint}>Citizens will be told this decision carries no appeal through this service.</p>
        )}
      </div>

      {/* ── FN-28 ── */}
      <div style={card}>
        <h3 style={h3}>RTI catalogue</h3>
        <label style={inlineLabel}>
          <input
            type="checkbox"
            checked={rtiOn}
            onChange={(e) =>
              onRtiChange(e.target.checked ? { ...(rti ?? {}), published: true } : { published: false })
            }
          />
          Publish this service to the RTI catalogue
        </label>

        {rtiOn ? (
          <label style={field}>
            <span style={labelText}>Public Information Officer (designation)</span>
            <input
              value={rti?.pioDesignationId ?? ""}
              placeholder="e.g. deputy_commissioner"
              onChange={(e) => onRtiChange({ ...(rti ?? { published: true }), published: true, pioDesignationId: e.target.value })}
              style={input}
            />
            <span style={hint}>
              Required. The RTI Act expects an officer to receive requests, so publish is blocked
              without one.
            </span>
          </label>
        ) : null}

        <p style={{ ...hint, marginTop: 10 }}>
          The export carries service metadata only — name, pattern, fee, SLA, channels and the
          <em> types</em> of document required. No applicant answers can reach it.
        </p>
      </div>

      {/* ── FN-18 / FN-32 ── */}
      <div style={card}>
        <h3 style={h3}>Languages</h3>
        <label style={field}>
          <span style={labelText}>Locales this service publishes in</span>
          <input
            value={locales.join(", ")}
            placeholder="en, or"
            onChange={(e) =>
              onLocalesChange(
                e.target.value.split(",").map((s) => s.trim()).filter((s) => s.length > 0),
              )
            }
            style={input}
          />
          <span style={hint}>
            Comma-separated, e.g. <code>en, or</code>. GIGW expects English plus at least one
            regional language; with fewer than two the accessibility preview raises a warning —
            a warning, not a block, so an English-first pilot can still go live.
          </span>
        </label>
      </div>
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
