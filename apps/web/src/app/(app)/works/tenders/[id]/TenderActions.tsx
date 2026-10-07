"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, useToast, Card, Button, EntityPicker } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { searchContractors, resolveContractors } from "@/lib/entityAdapters/contractor";

export interface TenderQuotationOption {
  id: string;
  contractorId: string | null;
  contractorName: string | null;
  quotedAmountMinor: string | null;
  method: string | null;
  status: string;
}

interface TenderActionsProps {
  tenderId: string;
  workId: string | null;
  awardId: string | null;
  /** GAP-WORKS-TENDERS-DETAIL-02: server-mirrored role gates. */
  canDaoFinalize?: boolean;
  canDoFinalize?: boolean;
  /** GAP-WORKS-TENDERS-DETAIL-06: quotations to award from. */
  quotations?: TenderQuotationOption[];
}

type QuotationMethod = "percentage_rate" | "item_rate";
type AboveBelow = "above" | "below" | "at_par";

/** paise string -> rupees string for prefilling a rupees input. */
function minorToRupees(minor: string | null): string {
  if (!minor || !/^\d+$/.test(minor)) return "";
  const n = BigInt(minor);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}

export function TenderActions({
  tenderId,
  workId,
  awardId,
  canDaoFinalize = false,
  canDoFinalize = false,
  quotations = [],
}: TenderActionsProps) {
  const router = useRouter();
  const { toast } = useToast();

  // ── Add Quotation ──────────────────────────────────────────────────────────
  const [quotOpen, setQuotOpen] = useState(false);
  const [quotBusy, setQuotBusy] = useState(false);
  const [quotError, setQuotError] = useState("");
  const [contractorId, setContractorId] = useState<string | null>(null);
  const [contractorLabel, setContractorLabel] = useState("");
  const [method, setMethod] = useState<QuotationMethod>("item_rate");
  const [quotedAmountRs, setQuotedAmountRs] = useState("");
  const [quotedPercentage, setQuotedPercentage] = useState("");
  const [aboveBelow, setAboveBelow] = useState<AboveBelow>("at_par");
  const quotFormError = useFormError("quotation");

  async function handleAddQuotation(e: React.FormEvent) {
    e.preventDefault();
    // GAP-WORKS-TENDERS-DETAIL-01: a contractor must be picked from the register.
    if (!contractorId || !contractorLabel) {
      setQuotError("Select a registered contractor.");
      return;
    }
    setQuotBusy(true);
    setQuotError("");
    quotFormError.clear();
    try {
      // The quotation command accepts contractorName (the schema has no
      // contractorId yet); send the picked contractor's name. The picker
      // guarantees it maps to a single registered firm, removing the
      // spelling-variant ambiguity of free text.
      const body: Record<string, unknown> = { tenderId, contractorName: contractorLabel, method };
      if (method === "item_rate") {
        const minor = rupeesToMinorString(quotedAmountRs);
        if (minor === null) {
          setQuotError("Enter a valid quoted amount in rupees (up to 2 decimals).");
          setQuotBusy(false);
          return;
        }
        body.quotedAmountMinor = minor;
      } else {
        body.quotedPercentage = quotedPercentage;
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
      setContractorId(null);
      setContractorLabel("");
      setQuotedAmountRs("");
      setQuotedPercentage("");
      setQuotOpen(false);
      setTimeout(() => router.refresh(), 600);
    } catch (caught) {
      setQuotError(quotFormError.fromException("save", caught).message);
    } finally {
      setQuotBusy(false);
    }
  }

  // ── Create Award ───────────────────────────────────────────────────────────
  const [awardOpen, setAwardOpen] = useState(false);
  const [awardBusy, setAwardBusy] = useState(false);
  const [awardError, setAwardError] = useState("");
  const [selectedQuotationId, setSelectedQuotationId] = useState("");
  const [awardContractorId, setAwardContractorId] = useState<string | null>(null);
  const [awardContractorLabel, setAwardContractorLabel] = useState("");
  const [agreementNo, setAgreementNo] = useState("");
  const [workOrderNo, setWorkOrderNo] = useState("");
  const [workPeriodDays, setWorkPeriodDays] = useState("");
  const [billMode, setBillMode] = useState("abstract");
  const [acceptedAmountRs, setAcceptedAmountRs] = useState("");
  const [deviationReason, setDeviationReason] = useState("");
  const awardFormError = useFormError("work award");

  // GAP-WORKS-TENDERS-DETAIL-06: only item-rate quotations with a real amount
  // can be awarded from (percentage-rate carries no amount).
  const eligibleQuotations = quotations.filter(
    (q) => q.quotedAmountMinor && /^\d+$/.test(q.quotedAmountMinor) && q.method !== "percentage_rate",
  );
  const selectedQuotation = eligibleQuotations.find((q) => q.id === selectedQuotationId) ?? null;

  // Lowest eligible bid (BigInt) — awarding above it needs a reason.
  const lowestEligibleMinor: bigint | null = eligibleQuotations.reduce<bigint | null>((min, q) => {
    const v = BigInt(q.quotedAmountMinor!);
    return min === null || v < min ? v : min;
  }, null);

  // Prefill contractor + accepted amount from the selected quotation.
  useEffect(() => {
    if (!selectedQuotation) return;
    setAwardContractorId(selectedQuotation.contractorId);
    setAwardContractorLabel(selectedQuotation.contractorName ?? "");
    setAcceptedAmountRs(minorToRupees(selectedQuotation.quotedAmountMinor));
  }, [selectedQuotationId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreateAward(e: React.FormEvent) {
    e.preventDefault();
    if (!workId) {
      setAwardError("Work ID is not available for this tender.");
      return;
    }
    // GAP-WORKS-TENDERS-DETAIL-06: an award must trace to a selected quotation.
    if (!selectedQuotationId) {
      setAwardError("Select the quotation being awarded.");
      return;
    }
    if (!awardContractorLabel) {
      setAwardError("Select a registered contractor.");
      return;
    }
    const minor = rupeesToMinorString(acceptedAmountRs);
    if (minor === null) {
      setAwardError("Enter a valid accepted amount in rupees (up to 2 decimals).");
      return;
    }
    // Awarding above the lowest eligible bid requires an explicit reason.
    const deviates = lowestEligibleMinor !== null && BigInt(minor) > lowestEligibleMinor;
    if (deviates && deviationReason.trim().length === 0) {
      setAwardError("Accepted amount is above the lowest bid — enter a reason to proceed.");
      return;
    }
    setAwardBusy(true);
    setAwardError("");
    awardFormError.clear();
    try {
      const body: Record<string, unknown> = {
        workId,
        contractorName: awardContractorLabel,
        acceptedAmountMinor: minor,
      };
      if (awardContractorId) body.contractorId = awardContractorId;
      if (agreementNo) body.agreementNumber = agreementNo;
      if (workOrderNo) body.workOrderNumber = workOrderNo;
      if (workPeriodDays) body.workPeriodDays = parseInt(workPeriodDays, 10);
      if (billMode) body.billMode = billMode;
      if (deviates) body.remarks = deviationReason.trim();
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
    } catch (caught) {
      setAwardError(awardFormError.fromException("save", caught).message);
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

  // GAP-WORKS-TENDERS-DETAIL-02: learn the award's finalize state so DO is
  // disabled until DAO has finalized (the server also enforces the order).
  const [awardStatus, setAwardStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!awardId) return;
    let cancelled = false;
    fetch(`/api/proxy/v1/works/tenders/award/${awardId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data?: { status?: string } } | null) => {
        if (!cancelled && body?.data?.status) setAwardStatus(body.data.status);
      })
      .catch(() => {
        /* leave null — DO stays disabled-by-safety until status is known */
      });
    return () => {
      cancelled = true;
    };
  }, [awardId]);

  const daoFinalized = awardStatus === "dao_finalized" || awardStatus === "do_finalized";

  async function handleAwardFinalize(level: "dao" | "do", reason?: string) {
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
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reason ? { reason } : {}),
        },
      );
      if (!res.ok) {
        const resolved = await finalizeFormError.fromResponse(res, "save");
        setDialogError(resolved.message);
        return;
      }
      toast.success(`Award ${level.toUpperCase()} finalization submitted. It will show as finalized once processed.`);
      setDialogOpen(false);
      setTimeout(() => router.refresh(), 600);
    } catch (caught) {
      setDialogError(finalizeFormError.fromException("save", caught).message);
    } finally {
      setDialogBusy(false);
    }
  }

  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)", marginBottom: 4 } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Add Quotation ─────────────────────────────────────────────────── */}
      <Card title="Add Quotation">
        {!quotOpen ? (
          <div style={{ padding: "12px 20px" }}>
            <Button onClick={() => setQuotOpen(true)} variant="primary">
              + Add Quotation
            </Button>
          </div>
        ) : (
          <form onSubmit={handleAddQuotation} style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label htmlFor="tender-quot-contractor" style={labelStyle}>
                  Contractor <span aria-hidden>*</span>
                </label>
                <EntityPicker
                  id="tender-quot-contractor"
                  aria-label="Contractor"
                  value={contractorId}
                  onChange={(v) => {
                    const id = Array.isArray(v) ? v[0] ?? null : v;
                    setContractorId(id);
                    if (!id) setContractorLabel("");
                  }}
                  search={async (q, signal) => {
                    const opts = await searchContractors(q, signal);
                    return opts;
                  }}
                  resolve={resolveContractors}
                  placeholder="Search registered contractors…"
                />
                {/* capture the label of the chosen option for the name payload */}
                <ContractorLabelSync id={contractorId} onLabel={setContractorLabel} />
                {quotFormError.fieldError("contractorName") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{quotFormError.fieldError("contractorName")}</span>
                )}
              </div>
              <div>
                <label htmlFor="tender-quot-method" style={labelStyle}>
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
                <label htmlFor="tender-quot-amount" style={labelStyle}>
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
                  <label htmlFor="tender-quot-percentage" style={labelStyle}>
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
                </div>
                <div>
                  <label htmlFor="tender-quot-above-below" style={labelStyle}>
                    Above / Below / At Par
                  </label>
                  <select id="tender-quot-above-below" className="input" value={aboveBelow} onChange={(e) => setAboveBelow(e.target.value as AboveBelow)}>
                    <option value="at_par">At Par</option>
                    <option value="above">Above</option>
                    <option value="below">Below</option>
                  </select>
                </div>
              </div>
            )}

            {quotError && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }} role="alert">{quotError}</p>}

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
              <Button onClick={() => setAwardOpen(true)} variant="secondary">
                + Create Award
              </Button>
            </div>
          ) : (
            <form onSubmit={handleCreateAward} style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label htmlFor="tender-award-quotation" style={labelStyle}>
                  Award this quotation <span aria-hidden>*</span>
                </label>
                <select
                  id="tender-award-quotation"
                  className="input"
                  value={selectedQuotationId}
                  onChange={(e) => setSelectedQuotationId(e.target.value)}
                >
                  <option value="">— Select the winning quotation —</option>
                  {eligibleQuotations.map((q) => (
                    <option key={q.id} value={q.id}>
                      {(q.contractorName ?? "Contractor")} — ₹{minorToRupees(q.quotedAmountMinor)}
                    </option>
                  ))}
                </select>
                {eligibleQuotations.length === 0 && (
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    No eligible item-rate quotations to award from yet.
                  </span>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label htmlFor="tender-award-contractor" style={labelStyle}>Contractor <span aria-hidden>*</span></label>
                  {/* Prefilled from the selected quotation; read-only to keep the
                      award traceable to the bid. */}
                  <input id="tender-award-contractor" className="input" value={awardContractorLabel} readOnly placeholder="From selected quotation" />
                </div>
                <div>
                  <label htmlFor="tender-award-amount" style={labelStyle}>
                    Accepted Amount (₹) <span aria-hidden>*</span>
                  </label>
                  <input
                    id="tender-award-amount"
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={acceptedAmountRs}
                    onChange={(e) => setAcceptedAmountRs(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label htmlFor="tender-award-agreement-no" style={labelStyle}>Agreement Number</label>
                  <input id="tender-award-agreement-no" className="input" value={agreementNo} onChange={(e) => setAgreementNo(e.target.value)} placeholder="Optional" />
                </div>
                <div>
                  <label htmlFor="tender-award-work-order-no" style={labelStyle}>Work Order Number</label>
                  <input id="tender-award-work-order-no" className="input" value={workOrderNo} onChange={(e) => setWorkOrderNo(e.target.value)} placeholder="Optional" />
                </div>
                <div>
                  <label htmlFor="tender-award-work-period-days" style={labelStyle}>Work Period (days)</label>
                  <input id="tender-award-work-period-days" className="input" type="number" min="1" value={workPeriodDays} onChange={(e) => setWorkPeriodDays(e.target.value)} placeholder="Optional" />
                </div>
                <div>
                  <label htmlFor="tender-award-bill-mode" style={labelStyle}>Bill Mode</label>
                  <select id="tender-award-bill-mode" className="input" value={billMode} onChange={(e) => setBillMode(e.target.value)}>
                    <option value="abstract">Abstract</option>
                    <option value="e_mb">e-MB</option>
                  </select>
                </div>
              </div>

              {lowestEligibleMinor !== null &&
                rupeesToMinorString(acceptedAmountRs) !== null &&
                BigInt(rupeesToMinorString(acceptedAmountRs)!) > lowestEligibleMinor && (
                  <div>
                    <label htmlFor="tender-award-deviation-reason" style={labelStyle}>
                      Reason for awarding above the lowest bid <span aria-hidden>*</span>
                    </label>
                    <input
                      id="tender-award-deviation-reason"
                      className="input"
                      value={deviationReason}
                      onChange={(e) => setDeviationReason(e.target.value)}
                      placeholder="Required when above lowest bid"
                    />
                  </div>
                )}

              {awardError && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }} role="alert">{awardError}</p>}

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
      {awardId && (canDaoFinalize || canDoFinalize) && (
        <Card title="Award Finalization">
          <div style={{ padding: "12px 20px", display: "flex", gap: 12, flexWrap: "wrap" }}>
            {canDaoFinalize && (
              <Button onClick={() => setDaoDialog(true)} variant="primary" disabled={daoFinalized}>
                DAO Finalize Award
              </Button>
            )}
            {canDoFinalize && (
              <Button
                onClick={() => setDoDialog(true)}
                variant="secondary"
                disabled={!daoFinalized}
                title={!daoFinalized ? "DAO must finalize the award first." : undefined}
              >
                DO Finalize Award
              </Button>
            )}
          </div>
          {canDoFinalize && !daoFinalized && (
            <p style={{ padding: "0 20px 12px", fontSize: 12, color: "var(--muted)" }}>
              DO finalization unlocks once the DAO has finalized the award.
            </p>
          )}
        </Card>
      )}

      {/* Dialogs */}
      <ConfirmDialog
        open={daoDialog}
        title="DAO Finalize Award"
        description="This will finalize the work award at the DAO level. Ensure DAO approval is obtained before proceeding."
        confirmLabel="Finalize"
        danger
        requireReason
        reasonLabel="Reason / approval reference"
        busy={daoBusy}
        errorMessage={daoError || undefined}
        onConfirm={(reason) => handleAwardFinalize("dao", reason)}
        onCancel={() => { setDaoDialog(false); setDaoError(""); }}
      />
      <ConfirmDialog
        open={doDialog}
        title="DO Finalize Award"
        description="This will finalize the work award at the DO level. This is the final step before work execution begins."
        confirmLabel="Finalize"
        danger
        requireReason
        reasonLabel="Reason / approval reference"
        busy={doBusy}
        errorMessage={doError || undefined}
        onConfirm={(reason) => handleAwardFinalize("do", reason)}
        onCancel={() => { setDoDialog(false); setDoError(""); }}
      />
    </div>
  );
}

/**
 * Tiny helper that keeps the picked contractor's human label in sync for the
 * name payload the quotation command still requires. Resolves the id to its
 * label via the same adapter the picker uses; no-op when nothing is selected.
 */
function ContractorLabelSync({ id, onLabel }: { id: string | null; onLabel: (label: string) => void }) {
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    resolveContractors([id])
      .then((opts) => {
        if (!cancelled && opts[0]) onLabel(opts[0].label);
      })
      .catch(() => {
        /* leave label empty — submit guard blocks on it */
      });
    return () => {
      cancelled = true;
    };
  }, [id, onLabel]);
  return null;
}
