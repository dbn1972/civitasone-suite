"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, useToast, Card, Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

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
  const quotFormError = useFormError("quotation");

  async function handleAddQuotation(e: React.FormEvent) {
    e.preventDefault();
    setQuotBusy(true);
    setQuotError("");
    quotFormError.clear();
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
        const resolved = await quotFormError.fromResponse(res, "save");
        setQuotError(resolved.message);
        return;
      }
      toast.success("Quotation submitted.");
      setContractorName("");
      setQuotedAmountRs("");
      setQuotedPercentage("");
      setQuotOpen(false);
      setTimeout(() => router.refresh(), 600);
    } catch {
      setQuotError(quotFormError.fromException("save").message);
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
  const awardFormError = useFormError("work award");

  async function handleCreateAward(e: React.FormEvent) {
    e.preventDefault();
    if (!workId) {
      setAwardError("Work ID is not available for this tender.");
      return;
    }
    setAwardBusy(true);
    setAwardError("");
    awardFormError.clear();
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
        const resolved = await awardFormError.fromResponse(res, "save");
        setAwardError(resolved.message);
        return;
      }
      toast.success("Work award submitted. It will be recorded once processed.");
      setAwardOpen(false);
      setTimeout(() => router.refresh(), 600);
    } catch {
      setAwardError(awardFormError.fromException("save").message);
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
  const finalizeFormError = useFormError("award finalization");

  async function handleAwardFinalize(level: "dao" | "do") {
    if (!awardId) return;
    const setDialogBusy = level === "dao" ? setDaoBusy : setDoBusy;
    const setDialogError = level === "dao" ? setDaoError : setDoError;
    const setDialogOpen = level === "dao" ? setDaoDialog : setDoDialog;
    setDialogBusy(true);
    setDialogError("");
    finalizeFormError.clear();
    try {
      const res = await fetch(
        `/api/proxy/v1/works/tenders/award/${awardId}/${level}-finalize`,
        { method: "POST" },
      );
      if (!res.ok) {
        const resolved = await finalizeFormError.fromResponse(res, "save");
        setDialogError(resolved.message);
        return;
      }
      toast.success(`Award ${level.toUpperCase()} finalization submitted. It will show as finalized once processed.`);
      setDialogOpen(false);
      setTimeout(() => router.refresh(), 600);
    } catch {
      setDialogError(finalizeFormError.fromException("save").message);
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
            <Button
              onClick={() => setQuotOpen(true)}
              variant="primary"
            >
              + Add Quotation
            </Button>
          </div>
        ) : (
          <form
            onSubmit={handleAddQuotation}
            style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label htmlFor="tender-quot-contractor-name" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>
                  Contractor Name <span aria-hidden>*</span>
                </label>
                <input
                  id="tender-quot-contractor-name"
                  className="input"
                  required
                  value={contractorName}
                  onChange={(e) => setContractorName(e.target.value)}
                  placeholder="Enter contractor name"
                />
                {quotFormError.fieldError("contractorName") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{quotFormError.fieldError("contractorName")}</span>
                )}
              </div>
              <div>
                <label htmlFor="tender-quot-method" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>
                  Method <span aria-hidden>*</span>
                </label>
                <select id="tender-quot-method" className="input" value={method} onChange={(e) => setMethod(e.target.value as QuotationMethod)}>
                  <option value="item_rate">Item Rate</option>
                  <option value="percentage_rate">Percentage Rate</option>
                </select>
              </div>
            </div>

            {method === "item_rate" ? (
              <div style={{ maxWidth: 280 }}>
                <label htmlFor="tender-quot-amount" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>
                  Quoted Amount (₹) <span aria-hidden>*</span>
                </label>
                <input
                  id="tender-quot-amount"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={quotedAmountRs}
                  onChange={(e) => setQuotedAmountRs(e.target.value)}
                  placeholder="0.00"
                />
                {quotFormError.fieldError("quotedAmountMinor") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{quotFormError.fieldError("quotedAmountMinor")}</span>
                )}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 560 }}>
                <div>
                  <label htmlFor="tender-quot-percentage" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>
                    Quoted % <span aria-hidden>*</span>
                  </label>
                  <input
                    id="tender-quot-percentage"
                    className="input"
                    type="number"
                    step="0.01"
                    required
                    value={quotedPercentage}
                    onChange={(e) => setQuotedPercentage(e.target.value)}
                    placeholder="0.00"
                  />
                  {quotFormError.fieldError("quotedPercentage") && (
                    <span style={{ fontSize: 12, color: "var(--bad)" }}>{quotFormError.fieldError("quotedPercentage")}</span>
                  )}
                </div>
                <div>
                  <label htmlFor="tender-quot-above-below" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>
                    Above / Below / At Par
                  </label>
                  <select
                    id="tender-quot-above-below"
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
              <Button type="submit" variant="primary" disabled={quotBusy}>
                {quotBusy ? "Saving…" : "Submit Quotation"}
              </Button>
              <Button variant="ghost" onClick={() => { setQuotOpen(false); setQuotError(""); }}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Card>

      {/* ── Create Award ──────────────────────────────────────────────────── */}
      {!awardId && (
        <Card title="Create Work Award">
          {!awardOpen ? (
            <div style={{ padding: "12px 20px" }}>
              <Button
                onClick={() => setAwardOpen(true)}
                variant="secondary"
              >
                + Create Award
              </Button>
            </div>
          ) : (
            <form
              onSubmit={handleCreateAward}
              style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label htmlFor="tender-award-contractor-name" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>
                    Contractor Name <span aria-hidden>*</span>
                  </label>
                  <input
                    id="tender-award-contractor-name"
                    className="input"
                    required
                    value={awardContractor}
                    onChange={(e) => setAwardContractor(e.target.value)}
                    placeholder="Awarded contractor"
                  />
                  {awardFormError.fieldError("contractorName") && (
                    <span style={{ fontSize: 12, color: "var(--bad)" }}>{awardFormError.fieldError("contractorName")}</span>
                  )}
                </div>
                <div>
                  <label htmlFor="tender-award-amount" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>
                    Accepted Amount (₹) <span aria-hidden>*</span>
                  </label>
                  <input
                    id="tender-award-amount"
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={acceptedAmountRs}
                    onChange={(e) => setAcceptedAmountRs(e.target.value)}
                    placeholder="0.00"
                  />
                  {awardFormError.fieldError("acceptedAmountMinor") && (
                    <span style={{ fontSize: 12, color: "var(--bad)" }}>{awardFormError.fieldError("acceptedAmountMinor")}</span>
                  )}
                </div>
                <div>
                  <label htmlFor="tender-award-agreement-no" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>Agreement Number</label>
                  <input id="tender-award-agreement-no" className="input" value={agreementNo} onChange={(e) => setAgreementNo(e.target.value)} placeholder="Optional" />
                  {awardFormError.fieldError("agreementNumber") && (
                    <span style={{ fontSize: 12, color: "var(--bad)" }}>{awardFormError.fieldError("agreementNumber")}</span>
                  )}
                </div>
                <div>
                  <label htmlFor="tender-award-work-order-no" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>Work Order Number</label>
                  <input id="tender-award-work-order-no" className="input" value={workOrderNo} onChange={(e) => setWorkOrderNo(e.target.value)} placeholder="Optional" />
                  {awardFormError.fieldError("workOrderNumber") && (
                    <span style={{ fontSize: 12, color: "var(--bad)" }}>{awardFormError.fieldError("workOrderNumber")}</span>
                  )}
                </div>
                <div>
                  <label htmlFor="tender-award-work-period-days" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>Work Period (days)</label>
                  <input id="tender-award-work-period-days" className="input" type="number" min="1" value={workPeriodDays} onChange={(e) => setWorkPeriodDays(e.target.value)} placeholder="Optional" />
                  {awardFormError.fieldError("workPeriodDays") && (
                    <span style={{ fontSize: 12, color: "var(--bad)" }}>{awardFormError.fieldError("workPeriodDays")}</span>
                  )}
                </div>
                <div>
                  <label htmlFor="tender-award-bill-mode" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 }}>Bill Mode</label>
                  <select id="tender-award-bill-mode" className="input" value={billMode} onChange={(e) => setBillMode(e.target.value)}>
                    <option value="RA">RA (Running Account)</option>
                    <option value="lump_sum">Lump Sum</option>
                    <option value="milestone">Milestone</option>
                  </select>
                </div>
              </div>

              {awardError && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{awardError}</p>}

              <div style={{ display: "flex", gap: 8 }}>
                <Button type="submit" variant="primary" disabled={awardBusy}>
                  {awardBusy ? "Saving…" : "Create Award"}
                </Button>
                <Button variant="ghost" onClick={() => { setAwardOpen(false); setAwardError(""); }}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}

      {/* ── Award Finalization (DAO → DO) ─────────────────────────────────── */}
      {awardId && (
        <Card title="Award Finalization">
          <div style={{ padding: "12px 20px", display: "flex", gap: 12 }}>
            <Button onClick={() => setDaoDialog(true)} variant="primary">
              DAO Finalize Award
            </Button>
            <Button onClick={() => setDoDialog(true)} variant="secondary">
              DO Finalize Award
            </Button>
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
