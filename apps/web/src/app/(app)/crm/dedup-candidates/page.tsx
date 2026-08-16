"use client";
/**
 * /crm/dedup-candidates — DQ-001 post-save duplicate review.
 *
 * Operators see flagged contact pairs side-by-side with a confidence score.
 * Fields that differ between the two contacts are highlighted amber so the
 * mismatch is obvious at a glance. Each pair can be:
 *   - Merged    — PATCH /v1/crm/contacts/:leftId/merge  { mergeIntoId }
 *   - Dismissed — PATCH /v1/crm/contacts/dedup-candidates/:pairId/dismiss
 *
 * On a failed API load the page shows DataSourceBadge rather than an empty
 * state that could be mistaken for "data is clean".
 */
import { useCallback, useEffect, useId, useState } from "react";
import { PageHeader, EmptyState, ConfirmDialog } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import {
  getDedupCandidates,
  mergeDedupPair,
  dismissDedupPair,
  type DedupPair,
  type DedupContactSnapshot,
  type DedupSource,
} from "@/lib/crm/dedupCandidates";

// ─── Confidence badge ─────────────────────────────────────────────────────────

function confidenceClass(score: number): string {
  if (score >= 80) return "conf-high";
  if (score >= 60) return "conf-mid";
  return "conf-low";
}

function ConfidenceBadge({ score }: { score: number }) {
  return (
    <span
      className={`conf-badge ${confidenceClass(score)}`}
      aria-label={`Confidence ${score}%`}
    >
      {score}%
    </span>
  );
}

// ─── Field comparison ─────────────────────────────────────────────────────────

const FIELDS: Array<{ key: keyof DedupContactSnapshot; label: string }> = [
  { key: "name",         label: "Name" },
  { key: "email",        label: "Email" },
  { key: "phone",        label: "Phone" },
  { key: "company",      label: "Company" },
  { key: "lastActivity", label: "Last activity" },
];

function differs(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() !== (b ?? "").trim().toLowerCase();
}

function fmt(key: keyof DedupContactSnapshot, v: string | null | undefined): string {
  if (v == null || v === "") return "—";
  if (key === "lastActivity") {
    try {
      return new Date(v).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return v;
    }
  }
  return v;
}

// ─── Pair card ────────────────────────────────────────────────────────────────

interface PairCardProps {
  pair: DedupPair;
  busyPairId: string | null;
  onMerge: (pair: DedupPair) => void;
  onDismiss: (pair: DedupPair) => void;
}

function PairCard({ pair, busyPairId, onMerge, onDismiss }: PairCardProps) {
  const headingId = useId();
  const busy = busyPairId === pair.pairId;

  return (
    <article className="dedup-card" aria-labelledby={headingId}>
      <div className="dedup-card-header">
        <h2 className="dedup-card-title" id={headingId}>
          <span className="dedup-name">{pair.left.name ?? "Unnamed"}</span>
          <span className="dedup-vs" aria-hidden="true">vs</span>
          <span className="dedup-name">{pair.right.name ?? "Unnamed"}</span>
        </h2>
        <ConfidenceBadge score={pair.confidence} />
      </div>

      <div className="dedup-grid" role="table" aria-label="Field comparison">
        <div className="dedup-grid-row dedup-thead" role="row">
          <div role="columnheader" />
          <div role="columnheader">Keep (left)</div>
          <div role="columnheader">Merge from (right)</div>
        </div>

        {FIELDS.map(({ key, label }) => {
          const diff = differs(
            pair.left[key] as string | null,
            pair.right[key] as string | null,
          );
          return (
            <div key={key} className="dedup-grid-row" role="row">
              <div className="dedup-field-label" role="rowheader">{label}</div>
              <div
                role="cell"
                className={diff ? "dedup-field-val dedup-diff" : "dedup-field-val"}
                title={diff ? "Values differ" : undefined}
              >
                {fmt(key, pair.left[key] as string | null)}
              </div>
              <div
                role="cell"
                className={diff ? "dedup-field-val dedup-diff" : "dedup-field-val"}
              >
                {fmt(key, pair.right[key] as string | null)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="dedup-actions">
        <button
          type="button"
          className="btn danger"
          onClick={() => onMerge(pair)}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? "Working…" : "Merge → keep left"}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => onDismiss(pair)}
          disabled={busy}
        >
          Dismiss pair
        </button>
      </div>
    </article>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DedupCandidatesPage() {
  const [pairs, setPairs]      = useState<DedupPair[]>([]);
  const [source, setSource]    = useState<DedupSource | "loading">("loading");
  const [busyPairId, setBusy]  = useState<string | null>(null);
  const [actionErr, setActErr] = useState<string | null>(null);

  // Merge confirm state
  const [mergeTarget, setMergeTarget] = useState<DedupPair | null>(null);
  const [mergeBusy, setMergeBusy]     = useState(false);
  const [mergeError, setMergeError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setSource("loading");
    const { data, source: s } = await getDedupCandidates();
    setPairs(data);
    setSource(s);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleDismiss(pair: DedupPair) {
    setBusy(pair.pairId);
    setActErr(null);
    try {
      await dismissDedupPair(pair.pairId);
      setPairs((prev) => prev.filter((p) => p.pairId !== pair.pairId));
    } catch (err) {
      setActErr(err instanceof Error ? err.message : "Dismiss failed");
    } finally {
      setBusy(null);
    }
  }

  function openMerge(pair: DedupPair) {
    setMergeTarget(pair);
    setMergeError(null);
  }

  function closeMerge() {
    if (!mergeBusy) { setMergeTarget(null); setMergeError(null); }
  }

  async function confirmMerge() {
    if (!mergeTarget) return;
    setMergeBusy(true);
    setMergeError(null);
    try {
      await mergeDedupPair(mergeTarget.left.id, mergeTarget.right.id);
      setPairs((prev) => prev.filter((p) => p.pairId !== mergeTarget.pairId));
      setMergeTarget(null);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setMergeBusy(false);
    }
  }

  const loading = source === "loading";

  return (
    <>
      <style>{STYLES}</style>

      <PageHeader
        title="Duplicate Candidates"
        subtitle="Review flagged contact pairs. Merge to consolidate records or dismiss if they are distinct people."
        back="/crm/data-quality"
        backLabel="Data Quality"
        actions={
          <button
            type="button"
            className="btn ghost"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {source === "error" && <DataSourceBadge source="error" />}

      {actionErr && (
        <div role="alert" className="dedup-alert">
          {actionErr}
        </div>
      )}

      {loading && (
        <div aria-label="Loading duplicate candidates" className="dedup-skeletons">
          {[0, 1, 2].map((i) => (
            <div key={i} className="dedup-skeleton" aria-hidden="true" />
          ))}
        </div>
      )}

      {!loading && pairs.length === 0 && source !== "error" && (
        <EmptyState
          icon="✓"
          title="No duplicate candidates found — data is clean"
          message="No flagged contact pairs at this time."
        />
      )}

      {!loading && pairs.length > 0 && (
        <div
          className="dedup-list"
          role="list"
          aria-label={`${pairs.length} duplicate candidate pair${pairs.length === 1 ? "" : "s"}`}
        >
          {pairs.map((pair) => (
            <div key={pair.pairId} role="listitem">
              <PairCard
                pair={pair}
                busyPairId={busyPairId}
                onMerge={openMerge}
                onDismiss={handleDismiss}
              />
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={mergeTarget !== null}
        title="Merge contacts?"
        description={
          mergeTarget
            ? `This will permanently merge ${mergeTarget.right.name ?? "the right contact"} into ${mergeTarget.left.name ?? "the left contact"}. This cannot be undone.`
            : undefined
        }
        confirmLabel="Merge"
        danger
        busy={mergeBusy}
        errorMessage={mergeError ?? undefined}
        onConfirm={() => void confirmMerge()}
        onCancel={closeMerge}
      />
    </>
  );
}

// ─── Scoped styles ────────────────────────────────────────────────────────────

const STYLES = `
.conf-badge {
  display: inline-flex;
  align-items: center;
  font-size: .75rem;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 9999px;
  letter-spacing: .02em;
}
.conf-high { background:#fef2f2; color:#b91c1c; }
.conf-mid  { background:#fffbeb; color:#92400e; }
.conf-low  { background:#f0fdf4; color:#166534; }

.dedup-list  { display: flex; flex-direction: column; gap: 0; }
.dedup-card  { background:var(--surface,#fff); border:1px solid var(--line,#e5e7eb);
               border-radius:12px; padding:20px 24px; margin-bottom:16px; }
.dedup-card-header { display:flex; align-items:center; justify-content:space-between;
                     gap:12px; margin-bottom:16px; flex-wrap:wrap; }
.dedup-card-title  { font-size:1rem; font-weight:600; margin:0; display:flex;
                     align-items:center; gap:8px; }
.dedup-name { color:var(--text,#111); }
.dedup-vs   { color:var(--muted,#6b7280); font-weight:400; font-size:.875rem; }

.dedup-grid      { display:grid; grid-template-columns:110px 1fr 1fr; gap:0;
                   margin-bottom:16px; }
.dedup-grid-row  { display:contents; }
.dedup-thead > div {
  font-size:.7rem; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
  color:var(--muted,#6b7280); padding:0 6px 6px;
  border-bottom:1px solid var(--line,#e5e7eb);
}
.dedup-field-label { color:var(--muted,#6b7280); font-size:.8rem; padding:5px 6px;
                     align-self:center; }
.dedup-field-val   { padding:5px 6px; border-radius:4px; font-size:.875rem;
                     color:var(--text,#111); word-break:break-word; }
.dedup-diff        { background:#fffbeb; outline:1px solid #fde68a; font-weight:500; }
.dedup-actions     { display:flex; gap:10px; flex-wrap:wrap; }
.dedup-alert       { background:#fef2f2; border:1px solid #fecaca; color:#b91c1c;
                     border-radius:8px; padding:10px 14px; font-size:.875rem;
                     margin-bottom:12px; }
.dedup-skeletons   { display:flex; flex-direction:column; gap:16px; margin-top:8px; }
.dedup-skeleton    { height:180px; border-radius:12px;
                     background:var(--surface-2,#f1f5f9);
                     animation:dc-pulse 1.4s ease-in-out infinite; }
@keyframes dc-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
@media (prefers-color-scheme:dark) {
  .conf-high  { background:#450a0a; color:#fca5a5; }
  .conf-mid   { background:#451a03; color:#fcd34d; }
  .conf-low   { background:#052e16; color:#86efac; }
  .dedup-diff { background:#422006; outline-color:#92400e; }
  .dedup-alert{ background:#450a0a; border-color:#7f1d1d; color:#fca5a5; }
}
`;
