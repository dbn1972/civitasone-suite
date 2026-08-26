"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, useToast, Card } from "@/app/_components/ds";

interface TenderActionsProps {
  tenderId: string;
  workId: string | null;
  awardId: string | null;
}

type QuotationMethod = "percentage_rate" | "item_rate";
type AboveBelow = "above" | "below" | "at_par";

export function TenderActions({ tenderId, workId, awardId }: TenderActionsProps) {
  const router = useRouter();
  const { toast } = useToast();

  // ── Add Quotation ──────────────────────────────────────────────────────────
  const [quotOpen, setQuotOpen] = useState(false);
  const [quotBusy, setQuotBusy] = useState(false);
  const [quotError, setQuotError] = useState("");
  const [contractorName, setContractorName] = useState("");
  const [method, setMethod] = useState<QuotationMethod>("item_rate");
  const [quotedAmountRs, setQuotedAmountRs] = useState("");
  const [quotedPercentage, setQuotedPercentage] = useState("");
  const [aboveBelow, setAboveBelow] = useState<AboveBelow>("at_par");

  async function handleAddQuotation(e: React.FormEvent) {
    e.preventDefault();
    setQuotBusy(true);
    setQuotError("");
    try {
      const body: Record<string, unknown> = { tenderId, contractorName, method };
      if (method === "item_rate") {
        body.quotedAmountMinor = String(Math.round(parseFloat(quotedAmountRs) * 100));
      } else {
        body.quotedPercentage = parseFloat(quotedPercentage);
        body.aboveOrBelowOrAtPar = aboveBelow;
      }
      const res = await fetch("/api/proxy/v1/works/tenders/quotation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setQuotError(await res.text().catch(() => "Request failed"));
        return;
      }
      toast.success("Quotation submitted.");
      setContractorName("");
      setQuotedAmountRs("");
      setQuotedPercentage("");
      setQuotOpen(false);
      setTimeout(() => router.refresh(), 600);
    } catch {
      setQuotError("Network error. Please try again.");
    } finally {
      setQuotBusy(false);
    }
  }

  // ── Create Award ───────────────────────────────────────────────────────────
  const [awardOpen, setAwardOpen] = useState(false);
  const [awardBusy, setAwardBusy] = useState(false);
  const [awardError, setAwardError] = useState("");
  const [awardContractor, setAwardContractor] = useState("");
  const [agreementNo, setAgreementNo] = useState("");
  const [workOrderNo, setWorkOrderNo] = useState("");
  const [workPeriodDays, setWorkPeriodDays] = useState("");
  const [billMode, setBillMode] = useState("RA");
  const [acceptedAmountRs, setAcceptedAmountRs] = useState("");

  async function handleCreateAward(e: React.FormEvent) {
    e.preventDefault();
    if (!workId) {
      setAwardError("Work ID is not available for this tender.");
      return;
    }
    setAwardBusy(true);
    setAwardError("");
    try {
      const body: Record<string, unknown> = {
        workId,
        contractorName: awardContractor,
        acceptedAmountMinor: String(Math.round(parseFloat(acceptedAmountRs) * 100)),
      };
      if (agreementNo) body.agreementNumber = agreementNo;
      if (workOrderNo) body.workOrderNumber = workOrderNo;
      if (workPeriodDays) body.workPeriodDays = parseInt(workPeriodDays, 10);
      if (billMode) body.billMode = billMode;
      const res = await fetch("/api/proxy/v1/works/tenders/award", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setAwardError(await res.text().catch(() => "Request failed"));
        return;
      }
      toast.success("Work award submitted. It will be recorded once processed.");
      setAwardOpen(false);
      setTimeout(() => router.refresh(), 600);
    } catch {
      setAwardError("Network error. Please try again.");
    } finally {
      setAwardBusy(false);
    }
  }

  // ── Award Finalize DAO / DO ────────────────────────────────────────────────
  const [daoDialog, setDaoDialog] = useState(false);
  const [daoBusy, setDaoBusy] = useState(false);
  const [daoError, setDaoError] = useState("");
  const [doDialog, setDoDialog] = useState(false);
  const [doBusy, setDoBusy] = useState(false);
  const [doError, setDoError] = useState("");

  async function handleAwardFinalize(level: "dao" | "do") {
    if (!awardId) return;
    const setDialogBusy = level === "dao" ? setDaoBusy : setDoBusy;
    const setDialogError = level === "dao" ? setDaoError : setDoError;
    const setDialogOpen = level === "dao" ? setDaoDialog : setDoDialog;
    setDialogBusy(true);
    setDialogError("");
    try {
      const res = await fetch(
        `/api/proxy/v1/works/tenders/award/${awardId}/${level}-finalize`,
        { method: "POST" },
      );
      if (!res.ok) {
        setDialogError(await res.text().catch(() => "Request failed"));
        return;
      }
      toast.success(`Award ${level.toUpperCase()} finalization submitted. It will show as finalized once processed.`);
      setDialogOpen(false);
      setTimeout(() => router.refresh(), 600);
    } catch {
      setDialogError("Network error. Please try again.");
    } finally {
      setDialogBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Add Quotation ─────────────────────────────────────────────────── */}
      <Card title="Add Quotation">
        {!quotOpen ? (
          <div style={{ padding: "12px 20px" }}>
            <button
              type="button"
              onClick={() => setQuotOpen(true)}
              className="btn primary"
            >
              + Add Quotation
            </button>
          </div>
        ) : (
          <form
            onSubmit={handleAddQuotation}
            style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>
                  Contractor Name <span aria-hidden>*</span>
                </label>
                <input
                  className="input"
                  required
                  value={contractorName}
                  onChange={(e) => setContractorName(e.target.value)}
                  placeholder="Enter contractor name"
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>
                  Method <span aria-hidden>*</span>
                </label>
                <select className="input" value={method} onChange={(e) => setMethod(e.target.value as QuotationMethod)}>
                  <option value="item_rate">Item Rate</option>
                  <option value="percentage_rate">Percentage Rate</option>
                </select>
              </div>
            </div>

            {method === "item_rate" ? (
              <div style={{ maxWidth: 280 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>
                  Quoted Amount (₹) <span aria-hidden>*</span>
                </label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={quotedAmountRs}
                  onChange={(e) => setQuotedAmountRs(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 560 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>
                    Quoted % <span aria-hidden>*</span>
                  </label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    required
                    value={quotedPercentage}
                    onChange={(e) => setQuotedPercentage(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>
                    Above / Below / At Par
                  </label>
                  <select
                    className="input"
                    value={aboveBelow}
                    onChange={(e) => setAboveBelow(e.target.value as AboveBelow)}
                  >
                    <option value="at_par">At Par</option>
                    <option value="above">Above</option>
                    <option value="below">Below</option>
                  </select>
                </div>
              </div>
            )}

            {quotError && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{quotError}</p>}

            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn primary" disabled={quotBusy}>
                {quotBusy ? "Saving…" : "Submit Quotation"}
              </button>
              <button type="button" className="btn ghost" onClick={() => { setQuotOpen(false); setQuotError(""); }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </Card>

      {/* ── Create Award ──────────────────────────────────────────────────── */}
      {!awardId && (
        <Card title="Create Work Award">
          {!awardOpen ? (
            <div style={{ padding: "12px 20px" }}>
              <button
                type="button"
                onClick={() => setAwardOpen(true)}
                className="btn secondary"
              >
                + Create Award
              </button>
            </div>
          ) : (
            <form
              onSubmit={handleCreateAward}
              style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>
                    Contractor Name <span aria-hidden>*</span>
                  </label>
                  <input
                    className="input"
                    required
                    value={awardContractor}
                    onChange={(e) => setAwardContractor(e.target.value)}
                    placeholder="Awarded contractor"
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>
                    Accepted Amount (₹) <span aria-hidden>*</span>
                  </label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={acceptedAmountRs}
                    onChange={(e) => setAcceptedAmountRs(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>Agreement Number</label>
                  <input className="input" value={agreementNo} onChange={(e) => setAgreementNo(e.target.value)} placeholder="Optional" />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>Work Order Number</label>
                  <input className="input" value={workOrderNo} onChange={(e) => setWorkOrderNo(e.target.value)} placeholder="Optional" />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>Work Period (days)</label>
                  <input className="input" type="number" min="1" value={workPeriodDays} onChange={(e) => setWorkPeriodDays(e.target.value)} placeholder="Optional" />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>Bill Mode</label>
                  <select className="input" value={billMode} onChange={(e) => setBillMode(e.target.value)}>
                    <option value="RA">RA (Running Account)</option>
                    <option value="lump_sum">Lump Sum</option>
                    <option value="milestone">Milestone</option>
                  </select>
                </div>
              </div>

              {awardError && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{awardError}</p>}

              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit" className="btn primary" disabled={awardBusy}>
                  {awardBusy ? "Saving…" : "Create Award"}
                </button>
                <button type="button" className="btn ghost" onClick={() => { setAwardOpen(false); setAwardError(""); }}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </Card>
      )}

      {/* ── Award Finalization (DAO → DO) ─────────────────────────────────── */}
      {awardId && (
        <Card title="Award Finalization">
          <div style={{ padding: "12px 20px", display: "flex", gap: 12 }}>
            <button type="button" onClick={() => setDaoDialog(true)} className="btn primary">
              DAO Finalize Award
            </button>
            <button type="button" onClick={() => setDoDialog(true)} className="btn secondary">
              DO Finalize Award
            </button>
          </div>
        </Card>
      )}

      {/* Dialogs */}
      <ConfirmDialog
        open={daoDialog}
        title="DAO Finalize Award"
        description="This will finalize the work award at the DAO level. Ensure DAO approval is obtained before proceeding."
        confirmLabel="Finalize"
        danger
        busy={daoBusy}
        errorMessage={daoError || undefined}
        onConfirm={() => handleAwardFinalize("dao")}
        onCancel={() => { setDaoDialog(false); setDaoError(""); }}
      />
      <ConfirmDialog
        open={doDialog}
        title="DO Finalize Award"
        description="This will finalize the work award at the DO level. This is the final step before work execution begins."
        confirmLabel="Finalize"
        danger
        busy={doBusy}
        errorMessage={doError || undefined}
        onConfirm={() => handleAwardFinalize("do")}
        onCancel={() => { setDoDialog(false); setDoError(""); }}
      />
    </div>
  );
}
