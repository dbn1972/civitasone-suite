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
import { useTranslations } from "next-intl";
import { Button, PageHeader, EmptyState, ConfirmDialog } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import {
  getDedupCandidates,
  mergeDedupPair,
  dismissDedupPair,
  type DedupPair,
  type DedupContactSnapshot,
  type DedupSource,
} from "@/lib/crm/dedupCandidates";
import { maskEmail, maskPhone } from "@/app/_components/ds";

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
  // DPDP data minimisation (GAP-CRM-DEDUP-CANDIDATES-01): a duplicate reviewer
  // only needs enough of the contact PII to recognise a match, not the full
  // email/phone of both people side by side. Mask these by default; name and
  // company stay clear so the pair is still recognisable. A role-gated,
  // server-audited reveal is a backend-dependent follow-up (the dedup-candidates
  // endpoint and an audit sink do not exist yet — see dedupCandidates.ts).
  if (key === "email") return maskEmail(v);
  if (key === "phone") return maskPhone(v);
  return v;
}

// ─── Pair card ────────────────────────────────────────────────────────────────

interface PairCardProps {
  pair: DedupPair;
  /** True when the reviewer swapped sides, so `right` is the record kept (primary). */
  swapped: boolean;
  busyPairId: string | null;
  onMerge: (pair: DedupPair) => void;
  onDismiss: (pair: DedupPair) => void;
  onSwap: (pair: DedupPair) => void;
}

function PairCard({ pair, swapped, busyPairId, onMerge, onDismiss, onSwap }: PairCardProps) {
  const t = useTranslations("crmDedupCandidates");
  const headingId = useId();
  const busy = busyPairId === pair.pairId;

  // GAP-CRM-DEDUP-CANDIDATES-02: the reviewer can swap which record is kept.
  // `keep` is the surviving (primary) record; `from` is merged into it.
  const keep = swapped ? pair.right : pair.left;
  const from = swapped ? pair.left : pair.right;

  return (
    <article className="dedup-card" aria-labelledby={headingId}>
      <div className="dedup-card-header">
        <h2 className="dedup-card-title" id={headingId}>
          <span className="dedup-name">{keep.name ?? t("unnamed")}</span>
          <span className="dedup-vs" aria-hidden="true">vs</span>
          <span className="dedup-name">{from.name ?? t("unnamed")}</span>
        </h2>
        <ConfidenceBadge score={pair.confidence} />
      </div>

      <div className="dedup-grid" role="table" aria-label="Field comparison">
        <div className="dedup-grid-row dedup-thead" role="row">
          <div role="columnheader" />
          <div role="columnheader">{t("colKeep")}</div>
          <div role="columnheader">{t("colMergeFrom")}</div>
        </div>

        {FIELDS.map(({ key, label }) => {
          const diff = differs(
            keep[key] as string | null,
            from[key] as string | null,
          );
          return (
            <div key={key} className="dedup-grid-row" role="row">
              <div className="dedup-field-label" role="rowheader">{label}</div>
              <div
                role="cell"
                className={diff ? "dedup-field-val dedup-diff" : "dedup-field-val"}
                title={diff ? "Values differ" : undefined}
              >
                {fmt(key, keep[key] as string | null)}
              </div>
              <div
                role="cell"
                className={diff ? "dedup-field-val dedup-diff" : "dedup-field-val"}
              >
                {fmt(key, from[key] as string | null)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="dedup-actions">
        <Button
          variant="danger"
          onClick={() => onMerge(pair)}
          disabled={busy}
          loading={busy}
        >
          {busy ? t("working") : t("mergeKeep", { name: keep.name ?? t("primaryFallback") })}
        </Button>
        <Button
          variant="ghost"
          onClick={() => onSwap(pair)}
          disabled={busy}
          aria-label={t("swapAria")}
        >
          {t("swapSides")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => onDismiss(pair)}
          disabled={busy}
        >
          Dismiss pair
        </Button>
      </div>
    </article>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DedupCandidatesPage() {
  const t = useTranslations("crmDedupCandidates");
  const [pairs, setPairs]      = useState<DedupPair[]>([]);
  const [source, setSource]    = useState<DedupSource | "loading">("loading");
  const [actionErr, setActErr] = useState<string | null>(null);

  // GAP-CRM-DEDUP-CANDIDATES-02: which pairs the reviewer swapped (right kept).
  const [swapped, setSwapped] = useState<Record<string, boolean>>({});

  // GAP-CRM-DEDUP-CANDIDATES-04: client-side confidence filter (no backend
  // paging yet; the list is sorted highest-confidence first so the strongest
  // matches are reviewed first and a long queue can be narrowed).
  const [minConfidence, setMinConfidence] = useState(0);

  // Merge confirm state
  const [mergeTarget, setMergeTarget] = useState<DedupPair | null>(null);
  const [mergeBusy, setMergeBusy]     = useState(false);
  const [mergeError, setMergeError]   = useState<string | null>(null);

  // GAP-CRM-DEDUP-CANDIDATES-03: dismiss now goes through a confirmation, so a
  // mis-click can't permanently hide a real duplicate with no undo.
  const [dismissTarget, setDismissTarget] = useState<DedupPair | null>(null);
  const [dismissBusy, setDismissBusy]     = useState(false);
  const [dismissError, setDismissError]   = useState<string | null>(null);

  const load = useCallback(async (isLive: () => boolean = () => true) => {
    setSource("loading");
    const { data, source: s } = await getDedupCandidates();
    if (!isLive()) return;
    setPairs(data);
    setSource(s);
  }, []);

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => { live = false; };
  }, [load]);

  function toggleSwap(pair: DedupPair) {
    setSwapped((prev) => ({ ...prev, [pair.pairId]: !prev[pair.pairId] }));
  }

  function openDismiss(pair: DedupPair) {
    setDismissTarget(pair);
    setDismissError(null);
  }

  function closeDismiss() {
    if (!dismissBusy) { setDismissTarget(null); setDismissError(null); }
  }

  async function confirmDismiss(reason?: string) {
    if (!dismissTarget) return;
    setDismissBusy(true);
    setDismissError(null);
    setActErr(null);
    try {
      await dismissDedupPair(dismissTarget.pairId, reason);
      setPairs((prev) => prev.filter((p) => p.pairId !== dismissTarget.pairId));
      setDismissTarget(null);
    } catch (err) {
      setDismissError(err instanceof Error ? err.message : t("dismissFailed"));
    } finally {
      setDismissBusy(false);
    }
  }

  function openMerge(pair: DedupPair) {
    setMergeTarget(pair);
    setMergeError(null);
  }

  function closeMerge() {
    if (!mergeBusy) { setMergeTarget(null); setMergeError(null); }
  }

  async function confirmMerge(reason?: string) {
    if (!mergeTarget) return;
    const isSwapped = swapped[mergeTarget.pairId] ?? false;
    const primary = isSwapped ? mergeTarget.right : mergeTarget.left;
    const duplicate = isSwapped ? mergeTarget.left : mergeTarget.right;
    setMergeBusy(true);
    setMergeError(null);
    try {
      await mergeDedupPair(primary.id, duplicate.id, reason);
      setPairs((prev) => prev.filter((p) => p.pairId !== mergeTarget.pairId));
      setMergeTarget(null);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setMergeBusy(false);
    }
  }

  const loading = source === "loading";

  // Highest-confidence first (GAP-CRM-DEDUP-CANDIDATES-04), then apply the filter.
  const sortedPairs = [...pairs].sort((a, b) => b.confidence - a.confidence);
  const visiblePairs = sortedPairs.filter((p) => p.confidence >= minConfidence);

  const mergeKeepName = mergeTarget
    ? (swapped[mergeTarget.pairId] ? mergeTarget.right : mergeTarget.left).name ?? t("primaryContact")
    : t("primaryContact");
  const mergeFromName = mergeTarget
    ? (swapped[mergeTarget.pairId] ? mergeTarget.left : mergeTarget.right).name ?? t("otherContact")
    : t("otherContact");

  return (
    <>
      <style>{STYLES}</style>

      <PageHeader
        title="Duplicate Candidates"
        subtitle="Review flagged contact pairs. Merge to consolidate records or dismiss if they are distinct people."
        back="/crm/data-quality"
        backLabel="Data Quality"
        actions={
          <Button
            variant="ghost"
            onClick={() => void load()}
            disabled={loading}
            loading={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      {source === "error" && <DataSourceBadge source="error" />}

      {actionErr && (
        <div role="alert" className="dedup-alert">
          {actionErr}
        </div>
      )}

      {!loading && source !== "error" && pairs.length > 0 && (
        <div className="dedup-toolbar">
          <span className="dedup-count">
            {t("pairCount", { visible: visiblePairs.length.toLocaleString("en-IN"), total: pairs.length.toLocaleString("en-IN"), n: pairs.length })}
          </span>
          <label className="dedup-filter">
            <span>{t("minConfidence")}</span>
            <select
              value={String(minConfidence)}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
            >
              <option value="0">{t("confidenceAll")}</option>
              <option value="60">60%+</option>
              <option value="80">80%+</option>
              <option value="90">90%+</option>
            </select>
          </label>
        </div>
      )}

      {loading && (
        <div aria-label="Loading duplicate candidates" className="dedup-skeletons">
          {[0, 1, 2].map((i) => (
            <div key={i} className="dedup-skeleton" aria-hidden="true" />
          ))}
        </div>
      )}

      {!loading && (
        source === "error" ? null : pairs.length === 0 ? (
          <EmptyState
            icon="✓"
            title="No duplicate candidates found — data is clean"
            message="No flagged contact pairs at this time."
          />
        ) : visiblePairs.length === 0 ? (
          <EmptyState
            icon="🔎"
            title={t("noMatchTitle")}
            message={t("noMatchMessage")}
          />
        ) : null
      )}

      {!loading && visiblePairs.length > 0 && (
        <div
          className="dedup-list"
          role="list"
          aria-label={t("listAria", { countText: String(visiblePairs.length), n: visiblePairs.length })}
        >
          {visiblePairs.map((pair) => (
            <div key={pair.pairId} role="listitem">
              <PairCard
                pair={pair}
                swapped={swapped[pair.pairId] ?? false}
                busyPairId={null}
                onMerge={openMerge}
                onDismiss={openDismiss}
                onSwap={toggleSwap}
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
            ? t("mergeDescription", { from: mergeFromName, keep: mergeKeepName })
            : undefined
        }
        confirmLabel="Merge"
        danger
        requireReason
        minReasonLength={10}
        reasonLabel={t("mergeReasonLabel")}
        busy={mergeBusy}
        errorMessage={mergeError ?? undefined}
        onConfirm={(reason) => void confirmMerge(reason)}
        onCancel={closeMerge}
      />

      <ConfirmDialog
        open={dismissTarget !== null}
        title={t("dismissTitle")}
        description={
          dismissTarget
            ? t("dismissDescription")
            : undefined
        }
        confirmLabel={t("dismissConfirm")}
        danger
        optionalReason
        reasonLabel={t("dismissReasonLabel")}
        busy={dismissBusy}
        errorMessage={dismissError ?? undefined}
        onConfirm={(reason) => void confirmDismiss(reason)}
        onCancel={closeDismiss}
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

.dedup-toolbar { display:flex; align-items:center; justify-content:space-between;
                 gap:12px; flex-wrap:wrap; margin:4px 0 12px; }
.dedup-count   { font-size:.8rem; color:var(--muted,#6b7280); font-weight:600; }
.dedup-filter  { display:flex; align-items:center; gap:8px; font-size:.8rem;
                 color:var(--muted,#6b7280); }
.dedup-filter select { padding:6px 8px; min-height:36px; border-radius:8px;
                 border:1px solid var(--line,#e5e7eb); }

.dedup-list  { display: flex; flex-direction: column; gap: 0; }.dedup-card  { background:var(--surface,#fff); border:1px solid var(--line,#e5e7eb);
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
