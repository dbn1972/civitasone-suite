"use client";
/**
 * /crm/dedup-candidates — DQ-001 post-save duplicate review.
 *
 * Operators see flagged contact pairs side-by-side with a confidence score.
 * Fields that differ between the two contacts are highlighted amber so the
 * mismatch is obvious at a glance. Each pair can be:
 *   - Merged    — POST  /v1/crm/contacts/merge  { primaryId, duplicateId }
 *   - Dismissed — PATCH /v1/crm/contacts/dedup-candidates/:pairId/dismiss
 *
 * GAP-CRM-DEDUP-CANDIDATES-05: the merge call is a POST to /v1/crm/contacts/merge
 * with { primaryId, duplicateId } (see lib/crm/dedupCandidates.ts), NOT the
 * PATCH /:leftId/merge { mergeIntoId } this comment used to claim. The list
 * (GET /v1/crm/contacts/dedup-candidates) and dismiss
 * (PATCH /v1/crm/contacts/dedup-candidates/:pairId/dismiss) endpoints EXIST
 * server-side (services/crm-service contacts/dedup-routes.ts; see
 * dedupCandidates.ts for the full writeup). getDedupCandidates still fails
 * closed to a DataSourceBadge error state on any non-2xx rather than a
 * fabricated "data is clean".
 *
 * On a failed API load the page shows DataSourceBadge rather than an empty
 * state that could be mistaken for "data is clean".
 */
import { formatIndianDate } from "@/lib/formatters";
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
import { MaskedReveal } from "@/app/_components/ds/MaskedReveal";
import { useSessionIdentity } from "@/lib/auth/useSessionIdentity";
import { CRM_PII_READ_ROLES, CRM_MERGE_ROLES } from "@/lib/auth/crmRoles";

// ─── Confidence badge ─────────────────────────────────────────────────────────

/**
 * GAP-CRM-DEDUP-CANDIDATES-06: a HIGH confidence means "very likely the same
 * person" — it should read as a strong, actionable signal, not an alarm. The
 * old mapping painted a 92% match red (danger) and a weak match green (success),
 * which inverted the meaning. Now high = an emphasis (brand) colour, medium =
 * amber, low = muted; and a non-colour text cue ("High match"/"Medium
 * match"/"Low match") carries the same information for anyone who can't
 * distinguish the colours.
 */
function confidenceClass(score: number): string {
  if (score >= 80) return "conf-high";
  if (score >= 60) return "conf-mid";
  return "conf-low";
}

function confidenceLabel(score: number): string {
  if (score >= 80) return "High match";
  if (score >= 60) return "Medium match";
  return "Low match";
}

function ConfidenceBadge({ score }: { score: number }) {
  return (
    <span
      className={`conf-badge ${confidenceClass(score)}`}
      aria-label={`${confidenceLabel(score)}, confidence ${score}%`}
    >
      <span className="conf-label">{confidenceLabel(score)}</span>
      <span className="conf-pct">{score}%</span>
    </span>
  );
}

// ─── Field comparison ─────────────────────────────────────────────────────────

const FIELDS: Array<{ key: Exclude<keyof DedupContactSnapshot, "id">; labelKey: string }> = [
  { key: "name",         labelKey: "fieldName" },
  { key: "email",        labelKey: "fieldEmail" },
  { key: "phone",        labelKey: "fieldPhone" },
  { key: "company",      labelKey: "fieldCompany" },
  { key: "lastActivity", labelKey: "fieldLastActivity" },
];

/** i18n label keys for the match-reason fields the server reports (DedupField). */
const MATCH_FIELD_LABEL_KEYS: Record<string, string> = {
  name: "fieldName",
  email: "fieldEmail",
  phone: "fieldPhone",
  company: "fieldCompany",
  gstin: "fieldGstin",
  pan: "fieldPan",
};

function differs(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() !== (b ?? "").trim().toLowerCase();
}

/**
 * The exact shapes crm-service's maskEmail / maskPhone emit
 * (services/crm-service/src/shared/pii-crypto.ts): email = first character + "***" +
 * "@domain" ("p***@example.com"); phone = "*" repeated, then at most the last four digits
 * ("*******3210", or "****" for a very short number). A clear value that merely CONTAINS
 * a "*" (valid in an RFC 5322 local part) does not match either shape.
 */
const SERVER_MASKED_EMAIL = /^.\*\*\*@/u;
const SERVER_MASKED_PHONE = /^\*+\d{0,4}$/;

/**
 * GAP-CRM-DEDUP-CANDIDATES-01: the server masks email/phone before they leave
 * crm-service, so show a value in the server's mask shape as received. Anything else
 * came from a server that has not been upgraded (web deployed ahead of crm-service);
 * mask it here so the clear value is never rendered either way. This tests the mask
 * SHAPE, not merely the presence of a "*", so an unmasked address like "a*b@x.in"
 * is still masked.
 */
function maskedFor(key: "email" | "phone", v: string): string {
  if (key === "email" ? SERVER_MASKED_EMAIL.test(v) : SERVER_MASKED_PHONE.test(v)) return v;
  return key === "email" ? maskEmail(v) : maskPhone(v);
}

function fmt(key: keyof DedupContactSnapshot, v: string | null | undefined): string {
  if (v == null || v === "") return "—";
  if (key === "lastActivity") {
    try {
      return formatIndianDate(v);
    } catch {
      return v;
    }
  }
  // DPDP data minimisation (GAP-CRM-DEDUP-CANDIDATES-01): a duplicate reviewer
  // only needs enough of the contact PII to recognise a match, not the full
  // email/phone of both people side by side. These stay masked; name and company
  // stay clear so the pair is still recognisable. The clear value is reachable
  // only through PiiCell's audited reveal (POST /v1/crm/pii/reveal).
  if (key === "email" || key === "phone") return maskedFor(key, v);
  return v;
}

// ─── Email / phone cell ──────────────────────────────────────────────────────

/**
 * A masked email/phone value. A viewer whose role the server's reveal endpoint
 * accepts (CRM_PII_READ_ROLES) also gets a Reveal button that asks for a reason
 * and calls the audited reveal; everyone else sees the masked text with no
 * control. The button only decides what is OFFERED - the server re-checks the
 * role and writes the pii_reveal audit event.
 */
function PiiCell({
  contact,
  field,
  canReveal,
}: {
  contact: DedupContactSnapshot;
  field: "email" | "phone";
  canReveal: boolean;
}) {
  const t = useTranslations("crmDedupCandidates");
  const value = contact[field];
  const display = fmt(field, value);
  if (!value || !canReveal) return <>{display}</>;
  return (
    <MaskedReveal
      maskedText={display}
      resourceType="contact"
      resourceId={contact.id}
      field={field}
      label={t(field === "email" ? "revealEmailLabel" : "revealPhoneLabel", { name: contact.name ?? t("unnamed") })}
    />
  );
}

// ─── Pair card ────────────────────────────────────────────────────────────────

interface PairCardProps {
  pair: DedupPair;
  /** True when the reviewer swapped sides, so `right` is the record kept (primary). */
  swapped: boolean;
  busyPairId: string | null;
  /** Viewer holds a role the audited PII reveal accepts (display gate only). */
  canReveal: boolean;
  /**
   * Viewer holds a role POST /v1/crm/contacts/merge accepts (CRM_MERGE_ROLES, display gate
   * only). Merging is admin-only on the server; offering it (and the Swap that only decides
   * which record a merge keeps) to a plain crm_user walked them into a 403.
   */
  canMerge: boolean;
  onMerge: (pair: DedupPair) => void;
  onDismiss: (pair: DedupPair) => void;
  onSwap: (pair: DedupPair) => void;
}

function PairCard({ pair, swapped, busyPairId, canReveal, canMerge, onMerge, onDismiss, onSwap }: PairCardProps) {
  const t = useTranslations("crmDedupCandidates");
  const headingId = useId();
  const busy = busyPairId === pair.pairId;

  // GAP-CRM-DEDUP-CANDIDATES-02: the reviewer can swap which record is kept.
  // `keep` is the surviving (primary) record; `from` is merged into it.
  const keep = swapped ? pair.right : pair.left;
  const from = swapped ? pair.left : pair.right;

  // The server computes which fields differ on the CLEAR values before masking
  // (two different numbers can mask identically). Older servers send no list, so
  // fall back to comparing what is shown.
  const serverDiff = pair.diffFields ? new Set<string>(pair.diffFields) : null;
  const matchedLabels = (pair.matchedFields ?? []).map((f) => (MATCH_FIELD_LABEL_KEYS[f] ? t(MATCH_FIELD_LABEL_KEYS[f]) : f));

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

      {matchedLabels.length > 0 ? (
        <p className="dedup-matched">{t("matchedOn", { fields: matchedLabels.join(", ") })}</p>
      ) : null}

      <div className="dedup-grid" role="table" aria-label="Field comparison">
        <div className="dedup-grid-row dedup-thead" role="row">
          <div role="columnheader" />
          <div role="columnheader">{t("colKeep")}</div>
          <div role="columnheader">{t("colMergeFrom")}</div>
        </div>

        {FIELDS.map(({ key, labelKey }) => {
          const diff = serverDiff
            ? serverDiff.has(key)
            : differs(keep[key] as string | null, from[key] as string | null);
          const cell = (contact: DedupContactSnapshot) =>
            key === "email" || key === "phone" ? (
              <PiiCell contact={contact} field={key} canReveal={canReveal} />
            ) : (
              fmt(key, contact[key] as string | null)
            );
          return (
            <div key={key} className="dedup-grid-row" role="row">
              <div className="dedup-field-label" role="rowheader">{t(labelKey)}</div>
              <div
                role="cell"
                className={diff ? "dedup-field-val dedup-diff" : "dedup-field-val"}
                title={diff ? "Values differ" : undefined}
              >
                {cell(keep)}
              </div>
              <div
                role="cell"
                className={diff ? "dedup-field-val dedup-diff" : "dedup-field-val"}
              >
                {cell(from)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="dedup-actions">
        {canMerge && (
          <>
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
          </>
        )}
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
  // Display gate only: the server's reveal endpoint re-checks the role.
  const identity = useSessionIdentity();
  const canReveal = identity.roles.some((r) => CRM_PII_READ_ROLES.includes(r));
  const canMerge = identity.roles.some((r) => CRM_MERGE_ROLES.includes(r));
  const [pairs, setPairs]      = useState<DedupPair[]>([]);
  const [source, setSource]    = useState<DedupSource | "loading">("loading");
  const [actionErr, setActErr] = useState<string | null>(null);

  // GAP-CRM-DEDUP-CANDIDATES-02: which pairs the reviewer swapped (right kept).
  const [swapped, setSwapped] = useState<Record<string, boolean>>({});

  // GAP-CRM-DEDUP-CANDIDATES-04: client-side confidence filter (no backend
  // paging yet; the list is sorted highest-confidence first so the strongest
  // matches are reviewed first and a long queue can be narrowed).
  const [minConfidence, setMinConfidence] = useState(0);
  // GAP-CRM-DEDUP-CANDIDATES-04: client-side pagination so a large queue does
  // not render hundreds of full cards at once.
  const PAGE_SIZE = 15;
  const [currentPage, setCurrentPage] = useState(1);

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
  const totalPages = Math.max(1, Math.ceil(visiblePairs.length / PAGE_SIZE));
  // Reset to page 1 when filter changes (handled implicitly: currentPage is
  // clamped below so no useEffect needed for simple cases).
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const paginatedPairs = visiblePairs.slice(pageStart, pageStart + PAGE_SIZE);

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
              onChange={(e) => { setMinConfidence(Number(e.target.value)); setCurrentPage(1); }}
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
          {paginatedPairs.map((pair) => (
            <div key={pair.pairId} role="listitem">
              <PairCard
                pair={pair}
                swapped={swapped[pair.pairId] ?? false}
                busyPairId={null}
                canReveal={canReveal}
                canMerge={canMerge}
                onMerge={openMerge}
                onDismiss={openDismiss}
                onSwap={toggleSwap}
              />
            </div>
          ))}
        </div>
      )}

      {!loading && totalPages > 1 && (
        <nav aria-label="Dedup pairs pagination" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, margin: "16px 0", fontSize: 14 }}>
          <button
            className="btn ghost"
            disabled={safePage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
          >
            ← Prev
          </button>
          <span aria-live="polite">
            {t("page", { page: safePage, total: totalPages })}
          </span>
          <button
            className="btn ghost"
            disabled={safePage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            aria-label="Next page"
          >
            Next →
          </button>
        </nav>
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
  gap: 6px;
  font-size: .75rem;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 9999px;
  letter-spacing: .02em;
}
.conf-badge .conf-pct { font-variant-numeric: tabular-nums; }
/*
  GAP-CRM-DEDUP-CANDIDATES-06: high match = strong EMPHASIS (brand/info), not
  danger-red; medium = amber; low = muted. Colours come from design tokens that
  the .dark theme (civitas-ds.css) already redefines, so manual dark mode works
  without a prefers-color-scheme block. The "High/Medium/Low match" text label
  is the non-colour cue.
*/
.conf-high { background:var(--infobg); color:var(--info); }
.conf-mid  { background:var(--warnbg); color:var(--warn); }
.conf-low  { background:var(--surface-2); color:var(--muted); }

.dedup-toolbar { display:flex; align-items:center; justify-content:space-between;
                 gap:12px; flex-wrap:wrap; margin:4px 0 12px; }
.dedup-count   { font-size:.8rem; color:var(--muted); font-weight:600; }
.dedup-filter  { display:flex; align-items:center; gap:8px; font-size:.8rem;
                 color:var(--muted); }
.dedup-filter select { padding:6px 8px; min-height:36px; border-radius:8px;
                 border:1px solid var(--line); }

.dedup-list  { display: flex; flex-direction: column; gap: 0; }.dedup-card  { background:var(--surface); border:1px solid var(--line);
               border-radius:12px; padding:20px 24px; margin-bottom:16px; }
.dedup-card-header { display:flex; align-items:center; justify-content:space-between;
                     gap:12px; margin-bottom:16px; flex-wrap:wrap; }
.dedup-card-title  { font-size:1rem; font-weight:600; margin:0; display:flex;
                     align-items:center; gap:8px; }
.dedup-name { color:var(--text); }
.dedup-vs   { color:var(--muted); font-weight:400; font-size:.875rem; }

.dedup-matched   { font-size:.8rem; color:var(--muted); margin:0 0 12px; }
.dedup-grid      { display:grid; grid-template-columns:110px 1fr 1fr; gap:0;
                   margin-bottom:16px; }
.dedup-grid-row  { display:contents; }
.dedup-thead > div {
  font-size:.7rem; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
  color:var(--muted); padding:0 6px 6px;
  border-bottom:1px solid var(--line);
}
.dedup-field-label { color:var(--muted); font-size:.8rem; padding:5px 6px;
                     align-self:center; }
.dedup-field-val   { padding:5px 6px; border-radius:4px; font-size:.875rem;
                     color:var(--text); word-break:break-word; }
.dedup-diff        { background:var(--warnbg); outline:1px solid var(--warnbd); font-weight:500; }
.dedup-actions     { display:flex; gap:10px; flex-wrap:wrap; }
.dedup-alert       { background:var(--badbg); border:1px solid var(--badbd); color:var(--bad);
                     border-radius:8px; padding:10px 14px; font-size:.875rem;
                     margin-bottom:12px; }
.dedup-skeletons   { display:flex; flex-direction:column; gap:16px; margin-top:8px; }
.dedup-skeleton    { height:180px; border-radius:12px;
                     background:var(--surface-2);
                     animation:dc-pulse 1.4s ease-in-out infinite; }
@keyframes dc-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
`;
