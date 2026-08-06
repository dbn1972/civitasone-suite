"use client";

/**
 * Finance maker-checker actions (client).
 *
 * Checker actions (approve/pass) wrap the shared ActionButton/ConfirmDialog
 * primitive. Maker CREATE actions open a small form dialog that captures the
 * fields the finance validators actually require — a bare confirm cannot
 * create a sanction/bill/EFT (createSanctionBody needs sanctionNo, purpose,
 * headId, amountMinor; createBillBody needs billNo, vendorId, headId, ddoCode,
 * grossMinor; initiateEftBody needs billId, ddoCode, mode, amountMinor).
 *
 * MONEY: clerks type rupees; rupeesToMinorString converts without ever
 * touching floats. Minor units cross to the API as integers (Number of a
 * paise string is exact well past any sanction size) or as the string the
 * validator accepts (EFT).
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/app/_components/ds";
import { rupeesToMinorString } from "@/lib/money";

async function postJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!(res.ok || res.status === 202)) {
    const text = await res.text().catch(() => "");
    let msg = `Request failed (${res.status}).`;
    try {
      const j = JSON.parse(text);
      msg = j?.message ?? j?.error ?? msg;
    } catch { if (text) msg = text; }
    throw new Error(msg);
  }
}

async function patchJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!(res.ok || res.status === 202)) {
    const text = await res.text().catch(() => "");
    let msg = `Request failed (${res.status}).`;
    try {
      const j = JSON.parse(text);
      msg = j?.message ?? j?.error ?? msg;
    } catch { if (text) msg = text; }
    throw new Error(msg);
  }
}

/** Display a paise string as "₹1,23,456.78" using string math only. */
function minorToRupeesDisplay(minor: string): string {
  const digits = minor.replace(/^0+(?=\d)/, "");
  const padded = digits.padStart(3, "0");
  const rupees = padded.slice(0, -2);
  const paise = padded.slice(-2);
  return `₹${Number(rupees).toLocaleString("en-IN")}.${paise}`;
}

/* ── Shared form-dialog scaffolding ─────────────────────────────── */

function FieldRow({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--border, #cbd5e1)",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 14,
};

function FormDialog({
  title,
  description,
  submitLabel,
  busy,
  error,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  description: string;
  submitLabel: string;
  busy: boolean;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed", inset: 0, zIndex: 1000, display: "flex",
        alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)",
      }}
    >
      <div style={{ background: "var(--surface, #fff)", borderRadius: 12, width: "100%", maxWidth: 480, padding: 24, margin: 16, boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{title}</h2>
        <p style={{ fontSize: 13, color: "var(--text-secondary, #64748b)", marginBottom: 16 }}>{description}</p>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {children}
          {error && (
            <p role="alert" style={{ fontSize: 13, color: "#dc2626" }}>
              <span style={{ fontWeight: 600 }}>Error: </span>{error}
            </p>
          )}
          <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "Submitting…" : submitLabel}
            </button>
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Payments: release EFT (treasury, no bill context) ──────────── */

const EFT_MODES = ["NEFT", "RTGS", "IMPS", "DBT", "PFMS", "cheque"] as const;

export function PaymentActions() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [billId, setBillId] = useState("");
  const [ddoCode, setDdoCode] = useState("");
  const [mode, setMode] = useState<(typeof EFT_MODES)[number]>("NEFT");
  const [amountRupees, setAmountRupees] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const billIdId = useId();
  const ddoId = useId();
  const modeId = useId();
  const amtId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amountMinor = rupeesToMinorString(amountRupees);
    if (!billId.trim() || !ddoCode.trim() || !amountMinor) {
      setError("Bill ID, DDO code and a positive rupee amount are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await postJson("/api/proxy/v1/finance/payments/eft", {
        billId: billId.trim(),
        ddoCode: ddoCode.trim(),
        mode,
        amountMinor,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not release the payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={() => { setOpen(true); setError(""); }}>
        + New Payment
      </button>
      {open && (
        <FormDialog
          title="Release a payment"
          description="Initiates an outward EFT/PFMS disbursement against a passed bill. The amount must equal the bill's net payable (conservation is enforced server-side). Irreversible once submitted to the gateway."
          submitLabel="Release payment"
          busy={busy}
          error={error}
          onSubmit={submit}
          onClose={() => setOpen(false)}
        >
          <FieldRow id={billIdId} label="Bill ID (UUID of a passed bill)">
            <input id={billIdId} style={inputStyle} value={billId} onChange={(e) => setBillId(e.target.value)} required />
          </FieldRow>
          <FieldRow id={ddoId} label="DDO code">
            <input id={ddoId} style={inputStyle} value={ddoCode} onChange={(e) => setDdoCode(e.target.value)} maxLength={12} required />
          </FieldRow>
          <FieldRow id={modeId} label="Mode">
            <select id={modeId} style={inputStyle} value={mode} onChange={(e) => setMode(e.target.value as (typeof EFT_MODES)[number])}>
              {EFT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </FieldRow>
          <FieldRow id={amtId} label="Amount (₹, must equal the bill's net payable)">
            <input id={amtId} style={inputStyle} inputMode="decimal" placeholder="e.g. 125000.50" value={amountRupees} onChange={(e) => setAmountRupees(e.target.value)} required />
          </FieldRow>
        </FormDialog>
      )}
    </>
  );
}

/* ── Sanctions: approve (financial sanction authority) ──────────── */
export function SanctionApproveAction({ id }: { id: string }) {
  const router = useRouter();
  return (
    <ActionButton
      label="Approve sanction"
      className="btn primary"
      danger
      confirmTitle="Approve this sanction?"
      confirmDescription="Approval commits budget against the sanctioned head and authorises downstream bills/payments. The approving officer must be distinct from the proposer (maker-checker). This cannot be undone."
      confirmLabel="Approve"
      requireReason
      reasonLabel="Approving authority & reason"
      onConfirm={async (reason) => {
        await patchJson(`/api/proxy/v1/finance/sanctions/${id}/approve`, { reason });
      }}
      onSuccess={() => router.refresh()}
    />
  );
}

/* ── Bills: pass (pre-audit) and pay (treasury) ─────────────────── */
export function BillPassPayActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const s = (status ?? "").toLowerCase();
  const canPay = s === "passed" || s === "approved";

  const [open, setOpen] = useState(false);
  const [loadingBill, setLoadingBill] = useState(false);
  const [ddoCode, setDdoCode] = useState("");
  const [netMinor, setNetMinor] = useState<string | null>(null);
  const [amountDisplay, setAmountDisplay] = useState("");
  const [mode, setMode] = useState<(typeof EFT_MODES)[number]>("NEFT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ddoId = useId();
  const modeId = useId();

  async function openRelease() {
    setOpen(true);
    setError("");
    setLoadingBill(true);
    try {
      // The EFT must carry the bill's exact net amount; read it rather than
      // asking the officer to re-type money.
      const res = await fetch(`/api/proxy/v1/finance/bills/${id}/release-info`);
      if (res.ok) {
        const bill = (await res.json()) as { ddoCode?: string | null; netMinor?: string };
        if (bill.ddoCode) setDdoCode(bill.ddoCode);
        if (bill.netMinor) {
          setNetMinor(bill.netMinor);
          setAmountDisplay(minorToRupeesDisplay(bill.netMinor));
        }
      }
    } catch {
      // Officer can still fill the DDO code by hand; amount check happens server-side.
    } finally {
      setLoadingBill(false);
    }
  }

  async function submitRelease(e: React.FormEvent) {
    e.preventDefault();
    if (!ddoCode.trim() || !netMinor) {
      setError(!netMinor ? "Could not read the bill's net payable — reload and retry." : "DDO code is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await postJson("/api/proxy/v1/finance/payments/eft", {
        billId: id,
        ddoCode: ddoCode.trim(),
        mode,
        amountMinor: netMinor,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not release the payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ActionButton
        label="Pass bill"
        className="btn ghost"
        confirmTitle="Pass this bill for payment?"
        confirmDescription="Passing certifies the bill has cleared 3-way match and pre-audit. The passing officer must differ from the submitter. Downstream payment can then be released."
        confirmLabel="Pass bill"
        requireReason
        reasonLabel="Pre-audit officer & reason"
        onConfirm={async (reason) => {
          await patchJson(`/api/proxy/v1/finance/bills/${id}/approve`, { decision: "pass", reason });
        }}
        onSuccess={() => router.refresh()}
      />
      <button type="button" className="btn primary" disabled={!canPay} onClick={() => void openRelease()}>
        Release payment
      </button>
      {open && (
        <FormDialog
          title="Release payment for this bill"
          description={`Authorises an irreversible outward disbursement of ${amountDisplay || "the bill's net payable"} against the passed bill. A distinct treasury officer must authorise (maker-checker).`}
          submitLabel={loadingBill ? "Loading bill…" : "Release payment"}
          busy={busy || loadingBill}
          error={error}
          onSubmit={submitRelease}
          onClose={() => setOpen(false)}
        >
          <FieldRow id={ddoId} label="DDO code">
            <input id={ddoId} style={inputStyle} value={ddoCode} onChange={(e) => setDdoCode(e.target.value)} maxLength={12} required />
          </FieldRow>
          <FieldRow id={modeId} label="Mode">
            <select id={modeId} style={inputStyle} value={mode} onChange={(e) => setMode(e.target.value as (typeof EFT_MODES)[number])}>
              {EFT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </FieldRow>
        </FormDialog>
      )}
    </>
  );
}

/* ── List-level create actions (maker prepares; checker approves later) ── */

export function SanctionCreateAction() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sanctionNo, setSanctionNo] = useState("");
  const [purpose, setPurpose] = useState("");
  const [headId, setHeadId] = useState("");
  const [amountRupees, setAmountRupees] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const noId = useId();
  const purposeId = useId();
  const headIdId = useId();
  const amtId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const minor = rupeesToMinorString(amountRupees);
    if (!sanctionNo.trim() || purpose.trim().length < 3 || !headId.trim() || !minor) {
      setError("Sanction no, a purpose (min 3 chars), budget head ID and a positive rupee amount are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await postJson("/api/proxy/v1/finance/sanctions", {
        sanctionNo: sanctionNo.trim(),
        purpose: purpose.trim(),
        headId: headId.trim(),
        amountMinor: Number(minor),
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the sanction.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={() => { setOpen(true); setError(""); }}>
        + New Sanction
      </button>
      {open && (
        <FormDialog
          title="Raise a new sanction"
          description="Records a draft administrative/financial sanction for budget check. A distinct approving authority must sanction it before any expenditure is committed (maker-checker)."
          submitLabel="Create draft"
          busy={busy}
          error={error}
          onSubmit={submit}
          onClose={() => setOpen(false)}
        >
          <FieldRow id={noId} label="Sanction no">
            <input id={noId} style={inputStyle} value={sanctionNo} onChange={(e) => setSanctionNo(e.target.value)} maxLength={64} placeholder="e.g. SAN/2026/0042" required />
          </FieldRow>
          <FieldRow id={purposeId} label="Purpose">
            <input id={purposeId} style={inputStyle} value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={500} required />
          </FieldRow>
          <FieldRow id={headIdId} label="Budget head ID (UUID)">
            <input id={headIdId} style={inputStyle} value={headId} onChange={(e) => setHeadId(e.target.value)} required />
          </FieldRow>
          <FieldRow id={amtId} label="Amount (₹)">
            <input id={amtId} style={inputStyle} inputMode="decimal" placeholder="e.g. 250000" value={amountRupees} onChange={(e) => setAmountRupees(e.target.value)} required />
          </FieldRow>
        </FormDialog>
      )}
    </>
  );
}

export function BillCreateAction() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [billNo, setBillNo] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [headId, setHeadId] = useState("");
  const [ddoCode, setDdoCode] = useState("");
  const [grossRupees, setGrossRupees] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const noId = useId();
  const vendorIdId = useId();
  const headIdId = useId();
  const ddoId = useId();
  const grossId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const minor = rupeesToMinorString(grossRupees);
    if (!billNo.trim() || !vendorId.trim() || !headId.trim() || !ddoCode.trim() || !minor) {
      setError("Bill no, vendor ID, budget head ID, DDO code and a positive gross amount are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await postJson("/api/proxy/v1/finance/bills", {
        billNo: billNo.trim(),
        vendorId: vendorId.trim(),
        headId: headId.trim(),
        ddoCode: ddoCode.trim(),
        grossMinor: Number(minor),
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the bill.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={() => { setOpen(true); setError(""); }}>
        + New Bill
      </button>
      {open && (
        <FormDialog
          title="Submit a new bill"
          description="Lodges a bill for pre-audit and 3-way match. It must be passed by a distinct officer before payment can be released."
          submitLabel="Submit bill"
          busy={busy}
          error={error}
          onSubmit={submit}
          onClose={() => setOpen(false)}
        >
          <FieldRow id={noId} label="Bill no">
            <input id={noId} style={inputStyle} value={billNo} onChange={(e) => setBillNo(e.target.value)} maxLength={64} placeholder="e.g. BILL/2026/0108" required />
          </FieldRow>
          <FieldRow id={vendorIdId} label="Vendor ID (UUID)">
            <input id={vendorIdId} style={inputStyle} value={vendorId} onChange={(e) => setVendorId(e.target.value)} required />
          </FieldRow>
          <FieldRow id={headIdId} label="Budget head ID (UUID)">
            <input id={headIdId} style={inputStyle} value={headId} onChange={(e) => setHeadId(e.target.value)} required />
          </FieldRow>
          <FieldRow id={ddoId} label="DDO code">
            <input id={ddoId} style={inputStyle} value={ddoCode} onChange={(e) => setDdoCode(e.target.value)} maxLength={12} required />
          </FieldRow>
          <FieldRow id={grossId} label="Gross amount (₹)">
            <input id={grossId} style={inputStyle} inputMode="decimal" placeholder="e.g. 118000.00" value={grossRupees} onChange={(e) => setGrossRupees(e.target.value)} required />
          </FieldRow>
        </FormDialog>
      )}
    </>
  );
}
