"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, useToast, Card, Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import {
  BILL_FINALIZE_SEQUENCE,
  MB_FINALIZE_SEQUENCE,
  nextFinalizeStep,
  billStatusLabel,
} from "../../_data/format";
import { BILL_STEP_AUTHORITY, MB_STEP_AUTHORITY } from "@/lib/auth/workRoles";

type BillItem = { id: string; billNo: string; status: string };
type MbItem = { id: string; mbNumber: string; rawStatus: string };

interface BillingActionsProps {
  workId: string;
  /**
   * GAP-WORKS-BILLING-WORKID-03: whether the signed-in user holds a billing
   * finalize role (computed server-side on the page from getSessionRoles).
   * When false the irreversible Advance controls are not rendered — the
   * server stays the authority, this is defence-in-depth + honest UX.
   */
  canFinalize: boolean;
  bills: BillItem[];
}

/** Confirm-dialog copy that names the authority a step represents and the
 * exact from→to transition, kept truthful about reversibility. */
function stepDescription(
  label: string,
  fromStatus: string,
  toStatus: string,
  authorityMap: Record<string, string>,
): string {
  const authority = authorityMap[toStatus];
  const authorityNote = authority ? ` This step is the ${authority} finalization.` : "";
  return (
    `This will advance ${label} from "${billStatusLabel(fromStatus)}" to ` +
    `"${billStatusLabel(toStatus)}".${authorityNote} Once advanced it cannot be moved back.`
  );
}

export function BillingActions({ workId, canFinalize, bills }: BillingActionsProps) {
  const router = useRouter();
  const { toast } = useToast();

  // ── Bill finalize ──────────────────────────────────────────────────────────
  const [billDialog, setBillDialog] = useState<{
    billId: string;
    billNo: string;
    fromStatus: string;
    nextStatus: string;
  } | null>(null);
  const [billBusy, setBillBusy] = useState(false);
  const [billError, setBillError] = useState("");
  const billFormError = useFormError("bill");

  async function handleBillFinalize() {
    if (!billDialog) return;
    setBillBusy(true);
    setBillError("");
    billFormError.clear();
    try {
      const res = await fetch(
        `/api/proxy/v1/works/billing/bills/${billDialog.billId}/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nextStatus: billDialog.nextStatus }),
        },
      );
      if (!res.ok) {
        const resolved = await billFormError.fromResponse(res, "save");
        setBillError(resolved.message);
        return;
      }
      toast.success(
        `Bill ${billDialog.billNo} advanced to ${billStatusLabel(billDialog.nextStatus)}.`,
      );
      setBillDialog(null);
      setTimeout(() => router.refresh(), 600);
    } catch (caught) {
      setBillError(billFormError.fromException("save", caught).message);
    } finally {
      setBillBusy(false);
    }
  }

  // ── MB finalize (GAP-WORKS-BILLING-WORKID-04) ────────────────────────────────
  // The paste-a-UUID input + free Next-Status select is replaced by the real
  // list of MBs for this work, each with a single "advance one step" button
  // (nextFinalizeStep over MB_FINALIZE_SEQUENCE) — no UUID typing and no stage
  // skipping.
  const [mbs, setMbs] = useState<MbItem[]>([]);
  const [mbDialog, setMbDialog] = useState<{
    mbId: string;
    mbNumber: string;
    fromStatus: string;
    nextStatus: string;
  } | null>(null);
  const [mbBusy, setMbBusy] = useState(false);
  const [mbError, setMbError] = useState("");
  const mbFormError = useFormError("measurement book");

  const loadMbs = useCallback(async () => {
    try {
      const res = await fetch(`/api/proxy/v1/works/billing/${workId}/mbs`);
      if (!res.ok) return;
      const body = (await res.json()) as { data?: unknown };
      const rows = Array.isArray(body.data) ? body.data : [];
      setMbs(
        rows.map((r) => {
          const row = r as Record<string, unknown>;
          return {
            id: String(row.id ?? ""),
            mbNumber: String(row.mbNumber ?? ""),
            rawStatus: String(row.status ?? "draft"),
          };
        }),
      );
    } catch {
      // leave the list empty on failure; the finalize action simply won't show
    }
  }, [workId]);

  useEffect(() => {
    void loadMbs();
  }, [loadMbs]);

  async function handleMbFinalize() {
    if (!mbDialog) return;
    setMbBusy(true);
    setMbError("");
    mbFormError.clear();
    try {
      const res = await fetch(
        `/api/proxy/v1/works/billing/mb/${mbDialog.mbId}/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nextStatus: mbDialog.nextStatus }),
        },
      );
      if (!res.ok) {
        const resolved = await mbFormError.fromResponse(res, "save");
        setMbError(resolved.message);
        return;
      }
      toast.success(
        `MB ${mbDialog.mbNumber} advanced to ${billStatusLabel(mbDialog.nextStatus)}.`,
      );
      setMbDialog(null);
      await loadMbs();
      setTimeout(() => router.refresh(), 600);
    } catch (caught) {
      setMbError(mbFormError.fromException("save", caught).message);
    } finally {
      setMbBusy(false);
    }
  }

  // GAP-WORKS-BILLING-WORKID-02: only bills with a legitimate next step are
  // actionable. nextFinalizeStep returns null for draft→(start handled),
  // terminal (do_finalized) and UNKNOWN (e.g. "submitted", already at IFMS),
  // so an already-submitted bill is never offered a spurious advance.
  const actionableBills = canFinalize
    ? bills.filter((b) => nextFinalizeStep(BILL_FINALIZE_SEQUENCE, b.status) !== null)
    : [];
  const actionableMbs = canFinalize
    ? mbs.filter((m) => nextFinalizeStep(MB_FINALIZE_SEQUENCE, m.rawStatus) !== null)
    : [];

  // GAP-WORKS-BILLING-WORKID-03: a viewer without the finalize role sees no
  // irreversible controls at all.
  if (!canFinalize) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
      {/* ── Bill finalization stepper ──────────────────────────────────────── */}
      {actionableBills.length > 0 && (
        <Card title="Finalize Bills">
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            {actionableBills.map((bill) => {
              const next = nextFinalizeStep(BILL_FINALIZE_SEQUENCE, bill.status)!;
              return (
                <div
                  key={bill.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    borderBottom: "1px solid var(--border)",
                    paddingBottom: 10,
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{bill.billNo}</span>
                    <span style={{ marginInlineStart: 12, fontSize: 12, color: "var(--ink3)" }}>
                      Current: {billStatusLabel(bill.status)}
                    </span>
                  </div>
                  <Button
                    onClick={() =>
                      setBillDialog({
                        billId: bill.id,
                        billNo: bill.billNo,
                        fromStatus: bill.status,
                        nextStatus: next,
                      })
                    }
                    variant="primary"
                    style={{ minHeight: 32, fontSize: 12, padding: "4px 12px" }}
                  >
                    → {billStatusLabel(next)}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── MB finalization (GAP-WORKS-BILLING-WORKID-04: real list, one step) ── */}
      {actionableMbs.length > 0 && (
        <Card title="Finalize Measurement Books">
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            {actionableMbs.map((mb) => {
              const next = nextFinalizeStep(MB_FINALIZE_SEQUENCE, mb.rawStatus)!;
              return (
                <div
                  key={mb.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    borderBottom: "1px solid var(--border)",
                    paddingBottom: 10,
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{mb.mbNumber}</span>
                    <span style={{ marginInlineStart: 12, fontSize: 12, color: "var(--ink3)" }}>
                      Current: {billStatusLabel(mb.rawStatus)}
                    </span>
                  </div>
                  <Button
                    onClick={() =>
                      setMbDialog({
                        mbId: mb.id,
                        mbNumber: mb.mbNumber,
                        fromStatus: mb.rawStatus,
                        nextStatus: next,
                      })
                    }
                    variant="primary"
                    style={{ minHeight: 32, fontSize: 12, padding: "4px 12px" }}
                  >
                    → {billStatusLabel(next)}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={billDialog !== null}
        title="Advance Bill Status"
        description={
          billDialog
            ? stepDescription(
                `bill "${billDialog.billNo}"`,
                billDialog.fromStatus,
                billDialog.nextStatus,
                BILL_STEP_AUTHORITY,
              )
            : ""
        }
        confirmLabel="Advance"
        danger
        busy={billBusy}
        errorMessage={billError || undefined}
        onConfirm={handleBillFinalize}
        onCancel={() => {
          setBillDialog(null);
          setBillError("");
        }}
      />

      <ConfirmDialog
        open={mbDialog !== null}
        title="Advance Measurement Book"
        description={
          mbDialog
            ? stepDescription(
                `measurement book "${mbDialog.mbNumber}"`,
                mbDialog.fromStatus,
                mbDialog.nextStatus,
                MB_STEP_AUTHORITY,
              )
            : ""
        }
        confirmLabel="Advance"
        danger
        busy={mbBusy}
        errorMessage={mbError || undefined}
        onConfirm={handleMbFinalize}
        onCancel={() => {
          setMbDialog(null);
          setMbError("");
        }}
      />
    </div>
  );
}
