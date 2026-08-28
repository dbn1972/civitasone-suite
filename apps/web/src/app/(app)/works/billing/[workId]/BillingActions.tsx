"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, useToast, Card } from "@/app/_components/ds";

type BillItem = { id: string; billNo: string; status: string };

interface BillingActionsProps {
  bills: BillItem[];
}

const BILL_SEQUENCE = [
  "so_finalized",
  "sdo_finalized",
  "auditor_finalized",
  "dao_finalized",
  "do_finalized",
] as const;

const MB_SEQUENCE = [
  "so_finalized",
  "sdo_finalized",
  "estimator_finalized",
  "do_finalized",
] as const;

function nextInSequence(seq: readonly string[], current: string): string | null {
  const idx = seq.indexOf(current);
  if (idx === -1) return seq[0];
  if (idx >= seq.length - 1) return null;
  return seq[idx + 1];
}

function statusLabel(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function BillingActions({ bills }: BillingActionsProps) {
  const router = useRouter();
  const { toast } = useToast();

  // ── Bill finalize ──────────────────────────────────────────────────────────
  const [billDialog, setBillDialog] = useState<{
    billId: string;
    billNo: string;
    nextStatus: string;
  } | null>(null);
  const [billBusy, setBillBusy] = useState(false);
  const [billError, setBillError] = useState("");

  async function handleBillFinalize() {
    if (!billDialog) return;
    setBillBusy(true);
    setBillError("");
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
        setBillError(await res.text().catch(() => "Request failed"));
        return;
      }
      toast.success(
        `Bill ${billDialog.billNo} advanced to ${statusLabel(billDialog.nextStatus)}.`,
      );
      setBillDialog(null);
      setTimeout(() => router.refresh(), 600);
    } catch {
      setBillError("Network error. Please try again.");
    } finally {
      setBillBusy(false);
    }
  }

  // ── MB finalize ────────────────────────────────────────────────────────────
  const [mbId, setMbId] = useState("");
  const [mbNextStatus, setMbNextStatus] = useState<string>(MB_SEQUENCE[0]);
  const [mbDialog, setMbDialog] = useState(false);
  const [mbBusy, setMbBusy] = useState(false);
  const [mbError, setMbError] = useState("");

  function openMbDialog(e: React.FormEvent) {
    e.preventDefault();
    if (!mbId.trim()) return;
    setMbError("");
    setMbDialog(true);
  }

  async function handleMbFinalize() {
    if (!mbId.trim()) return;
    setMbBusy(true);
    setMbError("");
    try {
      const res = await fetch(
        `/api/proxy/v1/works/billing/mb/${mbId.trim()}/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nextStatus: mbNextStatus }),
        },
      );
      if (!res.ok) {
        setMbError(await res.text().catch(() => "Request failed"));
        return;
      }
      toast.success(`MB advanced to ${statusLabel(mbNextStatus)}.`);
      setMbDialog(false);
      setMbId("");
      setTimeout(() => router.refresh(), 600);
    } catch {
      setMbError("Network error. Please try again.");
    } finally {
      setMbBusy(false);
    }
  }

  const actionableBills = bills.filter(
    (b) => nextInSequence(BILL_SEQUENCE, b.status) !== null,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
      {/* ── Bill finalization stepper ──────────────────────────────────────── */}
      {actionableBills.length > 0 && (
        <Card title="Finalize Bills">
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            {actionableBills.map((bill) => {
              const next = nextInSequence(BILL_SEQUENCE, bill.status)!;
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
                    <span style={{ marginLeft: 12, fontSize: 12, color: "var(--ink3)" }}>
                      Current: {statusLabel(bill.status)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setBillDialog({ billId: bill.id, billNo: bill.billNo, nextStatus: next })
                    }
                    className="btn primary"
                    style={{ minHeight: 32, fontSize: 12, padding: "4px 12px" }}
                  >
                    → {statusLabel(next)}
                  </button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── MB finalization (manual ID entry — no list endpoint exists yet) ── */}
      <Card title="Finalize Measurement Book">
        <form
          onSubmit={openMbDialog}
          style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto",
              gap: 12,
              alignItems: "end",
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--ink3)",
                  marginBottom: 4,
                }}
              >
                MB ID <span aria-hidden>*</span>
              </label>
              <input
                type="text"
                className="input"
                placeholder="Paste full MB UUID"
                value={mbId}
                onChange={(e) => setMbId(e.target.value)}
                required
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--ink3)",
                  marginBottom: 4,
                }}
              >
                Next Status
              </label>
              <select
                className="input"
                value={mbNextStatus}
                onChange={(e) => setMbNextStatus(e.target.value)}
              >
                {MB_SEQUENCE.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="btn primary"
              disabled={mbBusy}
              style={{ minHeight: 36 }}
            >
              {mbBusy ? "Saving…" : "Advance MB"}
            </button>
          </div>
          {mbError && (
            <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{mbError}</p>
          )}
        </form>
      </Card>

      <ConfirmDialog
        open={billDialog !== null}
        title="Advance Bill Status"
        description={
          billDialog
            ? `This will advance bill "${billDialog.billNo}" to ${statusLabel(
                billDialog.nextStatus,
              )}. This cannot be undone.`
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
        open={mbDialog}
        title="Advance Measurement Book"
        description={`This will advance the measurement book to ${statusLabel(
          mbNextStatus,
        )}. This cannot be undone.`}
        confirmLabel="Advance"
        danger
        busy={mbBusy}
        errorMessage={mbError || undefined}
        onConfirm={handleMbFinalize}
        onCancel={() => {
          setMbDialog(false);
          setMbError("");
        }}
      />
    </div>
  );
}
