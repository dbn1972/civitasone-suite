"use client";
/**
 * DuplicateCheckPanel — DQ-001. Shows ranked potential duplicates found before
 * a new record is saved, and lets the clerk choose to merge instead of
 * continue anyway. Pure presentational: the parent owns the fetch + choice.
 */
import type { DuplicateCandidate } from "@/lib/crm/dataQuality";

export function DuplicateCheckPanel({
  candidates,
  checking,
  onMerge,
  onContinueAnyway,
  mergeHrefBase,
}: {
  candidates: DuplicateCandidate[];
  checking?: boolean;
  /** Called when the clerk picks a candidate to merge into instead of creating. */
  onMerge?: (candidate: DuplicateCandidate) => void;
  /** Called when the clerk acknowledges the warning and wants to create anyway. */
  onContinueAnyway?: () => void;
  /** When set, each candidate name links to `${mergeHrefBase}${id}`. */
  mergeHrefBase?: string;
}) {
  if (checking) {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0" }}>
        Checking for possible duplicates…
      </p>
    );
  }
  if (candidates.length === 0) return null;

  return (
    <section
      aria-label="Potential duplicates"
      role="region"
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 12,
        background: "#fffbeb",
        border: "1px solid #fde68a",
      }}
    >
      <h4 style={{ margin: "0 0 4px", fontSize: 14, color: "#92400e" }}>
        <span aria-hidden="true">⚠️</span> Potential duplicates found
      </h4>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: "#92400e" }}>
        {candidates.length === 1
          ? "A similar record already exists. Merge into it instead of creating a duplicate?"
          : `${candidates.length} similar records already exist. Merge into one instead of creating a duplicate?`}
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {candidates.map((c) => (
          <li
            key={c.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "8px 10px",
              background: "#fff",
              border: "1px solid var(--line)",
              borderRadius: 8,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {mergeHrefBase ? (
                  <a href={`${mergeHrefBase}${c.id}`}>{c.name ?? c.email ?? c.phone ?? c.id}</a>
                ) : (
                  c.name ?? c.email ?? c.phone ?? c.id
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {[c.email, c.phone, c.company].filter(Boolean).join(" · ") || "—"}
              </div>
              <div style={{ fontSize: 12, color: "#92400e", marginTop: 2 }}>
                Match {Math.round(c.score * 100)}%
                {c.matchedFields.length > 0 ? ` on ${c.matchedFields.join(", ")}` : ""}
              </div>
            </div>
            {onMerge ? (
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => onMerge(c)}
                style={{ whiteSpace: "nowrap" }}
              >
                Merge instead
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {onContinueAnyway ? (
        <button type="button" className="btn ghost sm" onClick={onContinueAnyway} style={{ marginTop: 10 }}>
          Continue anyway — this is a new record
        </button>
      ) : null}
    </section>
  );
}
