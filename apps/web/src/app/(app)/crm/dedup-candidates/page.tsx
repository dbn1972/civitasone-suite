"use client";
/**
 * DQ-005 — Dedup Candidates review page.
 *
 * Fetches flagged duplicate pairs from GET /v1/crm/contacts/dedup-candidates
 * and lets operators compare field values side-by-side, then either Merge or
 * Dismiss each pair. Merge is irreversible and confirmed via a ConfirmDialog.
 *
 * API contract:
 *   GET  /v1/crm/contacts/dedup-candidates       → { data: DedupPair[] }
 *   PATCH /v1/crm/contacts/{leftId}/merge         → { mergeIntoId: rightId }  (async 202)
 *   PATCH /v1/crm/contacts/dedup-candidates/{pairId}/dismiss
 */
import { useCallback, useEffect, useState } from "react";
import { PageHeader, ConfirmDialog } from "@/app/_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DedupContactSnapshot {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  lastActivity: string | null;
}

export interface DedupPair {
  pairId: string;
  left: DedupContactSnapshot;
  right: DedupContactSnapshot;
  /** 0-100 — weighted confidence that these contacts are the same person. */
  confidence: number;
  matchedFields: string[];
}

type PairsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; pairs: DedupPair[] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalisePairs(raw: unknown): DedupPair[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
    ? (raw as { data: unknown[] }).data
    : Array.isArray(raw) ? raw : [];
  const out: DedupPair[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.pairId !== "string") continue;
    out.push({
      pairId: r.pairId,
      left: parseSnapshot(r.left),
      right: parseSnapshot(r.right),
      confidence: typeof r.confidence === "number" ? r.confidence : Number(r.confidence) || 0,
      matchedFields: Array.isArray(r.matchedFields) ? r.matchedFields.map(String) : [],
    });
  }
  return out;
}

function parseSnapshot(raw: unknown): DedupContactSnapshot {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: typeof r.id === "string" ? r.id : "",
    name: typeof r.name === "string" ? r.name : "Unknown",
    email: str(r.email),
    phone: str(r.phone),
    company: str(r.company),
    lastActivity: str(r.lastActivity),
  };
}

/** Badge colour: ≥80 red · 60-79 amber · <60 green */
function badgeStyle(confidence: number): React.CSSProperties {
  if (confidence >= 80) return { background: "#fef2f2", color: "#b42318", border: "1px solid #fca5a5" };
  if (confidence >= 60) return { background: "#fffbeb", color: "#92400e", border: "1px solid #fcd34d" };
  return { background: "#ecfdf5", color: "#065f46", border: "1px solid #6ee7b7" };
}

const CONTACT_FIELDS: Array<{ key: keyof DedupContactSnapshot; label: string }> = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "company", label: "Company" },
  { key: "lastActivity", label: "Last Activity" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "64px 24px",
        textAlign: "center",
        gap: 16,
      }}
    >
      {/* Checkmark illustration */}
      <svg
        aria-hidden="true"
        width="64"
        height="64"
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="32" cy="32" r="32" fill="#ecfdf5" />
        <path
          d="M20 32l8 8 16-16"
          stroke="#059669"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div>
        <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>No duplicate candidates found</p>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Data is clean — no flagged pairs require review.
        </p>
      </div>
      <a className="btn ghost" href="/crm/data-quality" style={{ marginTop: 8 }}>
        Back to Data Quality
      </a>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 99,
        fontSize: 12,
        fontWeight: 700,
        ...badgeStyle(confidence),
      }}
      aria-label={`Confidence score ${confidence}%`}
    >
      {confidence}% match
    </span>
  );
}

interface PairCardProps {
  pair: DedupPair;
  onMerge: (pair: DedupPair) => void;
  onDismiss: (pair: DedupPair) => void;
  dismissing: boolean;
}

function PairCard({ pair, onMerge, onDismiss, dismissing }: PairCardProps) {
  const { left, right, confidence, matchedFields } = pair;

  return (
    <div
      className="card"
      style={{ marginBottom: 16 }}
      data-testid={`pair-card-${pair.pairId}`}
    >
      <div className="pad">
        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ConfidenceBadge confidence={confidence} />
            {matchedFields.length > 0 && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Matched on: {matchedFields.join(", ")}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => onMerge(pair)}
              style={{ minHeight: 36, fontSize: 13 }}
              aria-label={`Merge ${right.name} into ${left.name}`}
            >
              Merge &rarr; keep left
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => onDismiss(pair)}
              disabled={dismissing}
              style={{ minHeight: 36, fontSize: 13 }}
              aria-label={`Dismiss duplicate pair for ${left.name} and ${right.name}`}
            >
              {dismissing ? "Dismissing…" : "Dismiss pair"}
            </button>
          </div>
        </div>

        {/* Side-by-side table */}
        <div style={{ overflowX: "auto" }}>
          <table
            className="tbl"
            style={{ width: "100%", tableLayout: "fixed" }}
            aria-label={`Comparison: ${left.name} vs ${right.name}`}
          >
            <colgroup>
              <col style={{ width: "18%" }} />
              <col style={{ width: "41%" }} />
              <col style={{ width: "41%" }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Left — {left.name}</th>
                <th scope="col">Right — {right.name}</th>
              </tr>
            </thead>
            <tbody>
              {CONTACT_FIELDS.map(({ key, label }) => {
                const lv = left[key] ?? null;
                const rv = right[key] ?? null;
                const differs = lv !== rv;
                return (
                  <tr key={key}>
                    <td style={{ fontWeight: 600, fontSize: 12, color: "var(--muted)" }}>{label}</td>
                    <td>{lv || <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>}</td>
                    <td
                      style={
                        differs
                          ? { color: "#92400e", background: "#fffbeb", fontWeight: 500 }
                          : undefined
                      }
                      aria-label={differs ? `${label} differs` : undefined}
                    >
                      {rv || <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DedupCandidatesPage() {
  const [state, setState] = useState<PairsState>({ status: "loading" });
  const [pendingMerge, setPendingMerge] = useState<DedupPair | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState("");
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());

  const loadPairs = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await browserFetch("v1/crm/contacts/dedup-candidates");
      if (!res.ok) {
        setState({ status: "error", message: await errorMessageFromResponse(res) });
        return;
      }
      const body: unknown = await res.json();
      setState({ status: "ok", pairs: normalisePairs(body) });
    } catch (e) {
      setState({
        status: "error",
        message: e instanceof Error ? e.message : "Failed to load dedup candidates.",
      });
    }
  }, []);

  useEffect(() => {
    void loadPairs();
  }, [loadPairs]);

  async function doMerge() {
    if (!pendingMerge) return;
    setMergeBusy(true);
    setMergeError("");
    try {
      const res = await browserFetch(
        `v1/crm/contacts/${pendingMerge.left.id}/merge`,
        {
          method: "PATCH",
          body: JSON.stringify({ mergeIntoId: pendingMerge.right.id }),
        },
      );
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      // Remove the pair from local state immediately; background job completes async.
      setPendingMerge(null);
      setState((prev) =>
        prev.status === "ok"
          ? { status: "ok", pairs: prev.pairs.filter((p) => p.pairId !== pendingMerge.pairId) }
          : prev,
      );
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : "Merge failed. Please try again.");
    } finally {
      setMergeBusy(false);
    }
  }

  async function doDismiss(pair: DedupPair) {
    setDismissingIds((ids) => new Set([...ids, pair.pairId]));
    try {
      const res = await browserFetch(
        `v1/crm/contacts/dedup-candidates/${pair.pairId}/dismiss`,
        { method: "PATCH" },
      );
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      setState((prev) =>
        prev.status === "ok"
          ? { status: "ok", pairs: prev.pairs.filter((p) => p.pairId !== pair.pairId) }
          : prev,
      );
    } catch {
      // Non-fatal: the pair stays visible; the operator can retry.
    } finally {
      setDismissingIds((ids) => {
        const next = new Set(ids);
        next.delete(pair.pairId);
        return next;
      });
    }
  }

  const pairs = state.status === "ok" ? state.pairs : [];

  return (
    <>
      <PageHeader
        title="Duplicate Candidates"
        subtitle="Review flagged contact pairs, compare field values, and merge or dismiss."
        back="/crm/data-quality"
        backLabel="Data Quality"
        actions={
          <button
            type="button"
            className="btn ghost"
            onClick={() => void loadPairs()}
            aria-label="Refresh duplicate candidates"
            style={{ minHeight: 44 }}
          >
            Refresh
          </button>
        }
      />

      {state.status === "loading" && (
        <div role="status" aria-live="polite" style={{ padding: 24, color: "var(--muted)" }}>
          Loading duplicate candidates…
        </div>
      )}

      {state.status === "error" && (
        <div
          role="alert"
          style={{
            margin: "16px 0",
            padding: "12px 16px",
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 8,
            fontSize: 13,
            color: "#b42318",
          }}
        >
          {state.message}
          <button
            type="button"
            className="btn ghost"
            onClick={() => void loadPairs()}
            style={{ marginLeft: 12, fontSize: 12 }}
          >
            Retry
          </button>
        </div>
      )}

      {state.status === "ok" && pairs.length === 0 && <EmptyState />}

      {state.status === "ok" && pairs.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
            {pairs.length} pair{pairs.length !== 1 ? "s" : ""} flagged for review — highest confidence first.
          </p>
          {pairs.map((pair) => (
            <PairCard
              key={pair.pairId}
              pair={pair}
              onMerge={setPendingMerge}
              onDismiss={(p) => void doDismiss(p)}
              dismissing={dismissingIds.has(pair.pairId)}
            />
          ))}
        </div>
      )}

      {/* Merge confirm dialog */}
      <ConfirmDialog
        open={pendingMerge !== null}
        danger
        title="Merge contacts? This cannot be undone"
        description={
          pendingMerge ? (
            <>
              This will permanently merge{" "}
              <strong>{pendingMerge.right.name}</strong> into{" "}
              <strong>{pendingMerge.left.name}</strong>. This cannot be undone.
            </>
          ) : undefined
        }
        confirmLabel="Merge permanently"
        cancelLabel="Cancel"
        busy={mergeBusy}
        errorMessage={mergeError || undefined}
        onConfirm={() => void doMerge()}
        onCancel={() => {
          setPendingMerge(null);
          setMergeError("");
        }}
      />
    </>
  );
}
