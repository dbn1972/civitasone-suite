"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/app/_components/ds";

export type LifecycleBid = {
  bidId?: string;
  vendorId: string;
  vendorName: string;
  bidAmount?: number;
  technicalScore?: number;
  status: string;
};

/**
 * L1/L2 CRITICAL fix: the tender lifecycle (services/procurement-service/src/
 * modules/tender/{routes,domain}.ts) supports draft -> published ->
 * technical_evaluation -> financial_evaluation -> awarded, with real POST
 * endpoints for publish, technical-evaluation, open-financial, and award —
 * but before this component, NONE of them were reachable from the UI. A
 * tender could be created and its incoming bids viewed, but never published,
 * never technically evaluated, never have its sealed financial bids opened,
 * and never awarded. That's the three most consequential, legally significant
 * steps of a government tender process, entirely missing.
 *
 * The frontend only ever sees the collapsed status "evaluation" for both
 * technical_evaluation and financial_evaluation (procurement-service's
 * queries.ts mapTenderStatus intentionally collapses the two for the summary/
 * detail views). So instead of guessing which of the two we're in, this gates
 * on real per-bid data already in the response: once any bid shows a revealed
 * bidAmount, financial envelopes have provably been opened for at least one
 * bid, which is the signal used to reveal "Award". The backend remains the
 * source of truth for every transition — like DispatchPOActions and
 * SignSrnAction elsewhere in this module, a soft-gated action here that turns
 * out to be premature fails with the server's own real error message
 * (ActionButton/ConfirmDialog's errorMessage), it is never silently allowed.
 */
export function TenderLifecycleActions({
  tenderId,
  status,
  bids,
}: {
  tenderId: string;
  status: string;
  bids: LifecycleBid[];
}) {
  const router = useRouter();
  const [sanctionRef, setSanctionRef] = useState("");

  const evaluableBids = useMemo(() => bids.filter((b): b is LifecycleBid & { bidId: string } => !!b.bidId), [bids]);
  const anyFinancialOpened = bids.some((b) => b.bidAmount !== undefined);

  async function publish(): Promise<void> {
    const res = await fetch(`/api/proxy/v1/procurement/tenders/${tenderId}/publish`, { method: "POST" });
    if (!res.ok) throw new Error((await res.text()) || "Could not publish the tender.");
  }

  async function openFinancial(): Promise<void> {
    const res = await fetch(`/api/proxy/v1/procurement/tenders/${tenderId}/open-financial`, { method: "POST" });
    if (!res.ok) throw new Error((await res.text()) || "Could not open financial bids.");
  }

  async function award(): Promise<void> {
    const res = await fetch(`/api/proxy/v1/procurement/tenders/${tenderId}/award`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sanctionRef.trim() ? { sanctionRef: sanctionRef.trim() } : {}),
    });
    if (!res.ok) throw new Error((await res.text()) || "Could not award the tender.");
  }

  if (status === "draft") {
    return (
      <div className="card pad" style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <ActionButton
          label="Publish tender"
          confirmTitle="Publish this tender?"
          confirmDescription="This makes the tender visible to vendors for bidding."
          confirmLabel="Publish"
          onConfirm={publish}
          onSuccess={() => router.refresh()}
        />
      </div>
    );
  }

  if (status === "cancelled" || status === "awarded") {
    return null;
  }

  if (status !== "published" && status !== "evaluation") {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
      {!anyFinancialOpened && evaluableBids.length > 0 && (
        <TechnicalEvaluationForm tenderId={tenderId} bids={evaluableBids} onDone={() => router.refresh()} />
      )}

      {status === "evaluation" && (
        <div className="card pad" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
          {anyFinancialOpened && (
            <input
              className="inp"
              placeholder="Sanction reference (optional)"
              aria-label="Sanction reference (optional)"
              value={sanctionRef}
              onChange={(e) => setSanctionRef(e.target.value)}
              style={{ minHeight: 44, maxWidth: 260 }}
            />
          )}
          <ActionButton
            label="Open financial bids"
            confirmTitle="Open sealed financial bids?"
            confirmDescription="This reveals the financial amount for technically-qualified bids. Do this only after technical evaluation is complete — bids that haven't qualified stay sealed."
            confirmLabel="Open financial bids"
            onConfirm={openFinancial}
            onSuccess={() => router.refresh()}
          />
          {anyFinancialOpened && (
            <ActionButton
              label="Award tender"
              confirmTitle="Award this tender?"
              confirmDescription="This awards the tender to the lowest qualifying (L1) bidder and generates a purchase order. This cannot be undone. The approver must be different from both the tender's creator and its technical evaluator."
              confirmLabel="Award"
              danger
              onConfirm={award}
              onSuccess={() => router.refresh()}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TechnicalEvaluationForm({
  tenderId,
  bids,
  onDone,
}: {
  tenderId: string;
  bids: (LifecycleBid & { bidId: string })[];
  onDone: () => void;
}) {
  const [rows, setRows] = useState(() =>
    Object.fromEntries(
      bids.map((b) => [
        b.bidId,
        { qualified: b.status === "technically_qualified", score: b.technicalScore != null ? String(b.technicalScore) : "" },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function update(bidId: string, patch: Partial<{ qualified: boolean; score: string }>) {
    setSaved(false);
    setRows((prev) => ({ ...prev, [bidId]: { ...prev[bidId], ...patch } }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const results = bids.map((b) => {
        const row = rows[b.bidId];
        const score = row.score.trim() === "" ? undefined : Math.max(0, Math.min(100, parseInt(row.score, 10) || 0));
        return { bidId: b.bidId, qualified: row.qualified, score };
      });
      const res = await fetch(`/api/proxy/v1/procurement/tenders/${tenderId}/technical-evaluation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ results }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Could not save the technical evaluation.");
        return;
      }
      setSaved(true);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card pad" noValidate>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>Technical evaluation</h3>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">Vendor</th>
              <th scope="col">Qualified</th>
              <th scope="col" style={{ textAlign: "right" }}>Technical score (0–100)</th>
            </tr>
          </thead>
          <tbody>
            {bids.map((b) => (
              <tr key={b.bidId}>
                <td>{b.vendorName}</td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${b.vendorName} technically qualified`}
                    checked={rows[b.bidId].qualified}
                    onChange={(e) => update(b.bidId, { qualified: e.target.checked })}
                  />
                </td>
                <td style={{ textAlign: "right" }}>
                  <input
                    type="number"
                    className="inp"
                    min={0}
                    max={100}
                    aria-label={`${b.vendorName} technical score`}
                    value={rows[b.bidId].score}
                    onChange={(e) => update(b.bidId, { score: e.target.value })}
                    style={{ width: 80, textAlign: "right" }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? <p role="alert" style={{ marginTop: 10, color: "var(--bad)", fontSize: 13 }}>{error}</p> : null}
      {saved && !error ? <p role="status" style={{ marginTop: 10, color: "var(--good)", fontSize: 13 }}>Evaluation submitted.</p> : null}
      <div style={{ marginTop: 12 }}>
        <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>
          {busy ? "Saving…" : "Save technical evaluation"}
        </button>
      </div>
    </form>
  );
}
