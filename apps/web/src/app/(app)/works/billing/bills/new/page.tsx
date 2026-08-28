"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errBanner = { background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;

type BillMode = "e_mb" | "abstract";

/** rupees (as typed) → integer paise string, matching the money-minor contract. */
function toMinor(rupees: string): string {
  const n = Number(rupees || "0");
  return String(Math.round((Number.isFinite(n) ? n : 0) * 100));
}

function NewBillForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [form, setForm] = useState({
    workId: searchParams.get("workId") ?? "",
    awardId: searchParams.get("awardId") ?? "",
    mbId: searchParams.get("mbId") ?? "",
    billMode: "e_mb" as BillMode,
    billNumber: "",
    grossAmount: "",
    deductions: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  const grossNum = Number(form.grossAmount || "0");
  const dedNum = Number(form.deductions || "0");
  const netPreview =
    grossNum > 0 ? formatMoney(String(Math.round((grossNum - dedNum) * 100))) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!(grossNum > 0)) {
      setError("Gross amount must be greater than zero.");
      return;
    }
    if (dedNum < 0) {
      setError("Deductions cannot be negative.");
      return;
    }
    if (dedNum > grossNum) {
      setError("Deductions cannot exceed the gross amount.");
      return;
    }

    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        workId: form.workId.trim(),
        awardId: form.awardId.trim(),
        mbId: form.mbId.trim(),
        billMode: form.billMode,
        billNumber: form.billNumber.trim(),
        grossAmountMinor: toMinor(form.grossAmount),
      };
      if (form.deductions.trim()) body.deductionsMinor = toMinor(form.deductions);

      const res = await fetch("/api/proxy/v1/works/billing/bills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!res.ok) throw new Error(data?.message ?? "Create failed");
      setMessage("Bill created.");
      toast.success("Bill created.");
      setTimeout(
        () => router.push(form.workId.trim() ? `/works/billing/${form.workId.trim()}` : "/works/billing"),
        600,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const backHref = form.workId.trim() ? `/works/billing/${form.workId.trim()}` : "/works/billing";

  return (
    <>
      <PageHeader
        title="Generate Bill"
        subtitle="Raise a running/final bill against a finalized measurement book."
        back={backHref}
        backLabel="Billing"
      />
      {message ? (
        <div role="status" aria-live="polite" style={okBanner}>
          {message}
        </div>
      ) : null}
      {error ? (
        <div role="alert" aria-live="assertive" style={errBanner}>
          {error}
        </div>
      ) : null}
      <div className="card">
        <form
          onSubmit={submit}
          className="pad"
          style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 680 }}
        >
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            Fields marked * are required. The measurement book must be fully finalized
            (DO&nbsp;finalized) before a bill can be raised against it.
          </p>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <div>
              <label style={labelStyle} htmlFor="workId">Work ID (UUID) *</label>
              <input id="workId" style={inputStyle} type="text" required value={form.workId} onChange={set("workId")} placeholder="UUID of the work" />
            </div>
            <div>
              <label style={labelStyle} htmlFor="awardId">Award ID (UUID) *</label>
              <input id="awardId" style={inputStyle} type="text" required value={form.awardId} onChange={set("awardId")} placeholder="UUID of the award" />
              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Find in the Works Tenders list.</p>
            </div>
            <div>
              <label style={labelStyle} htmlFor="mbId">Measurement Book ID (UUID) *</label>
              <input id="mbId" style={inputStyle} type="text" required value={form.mbId} onChange={set("mbId")} placeholder="UUID of the finalized MB" />
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            }}
          >
            <div>
              <label style={labelStyle} htmlFor="billMode">Bill Mode *</label>
              <select id="billMode" style={inputStyle} value={form.billMode} onChange={set("billMode")} required>
                <option value="e_mb">e-MB (measurement-based)</option>
                <option value="abstract">Abstract</option>
              </select>
            </div>
            <div>
              <label style={labelStyle} htmlFor="billNumber">Bill Number *</label>
              <input id="billNumber" style={inputStyle} type="text" required maxLength={64} value={form.billNumber} onChange={set("billNumber")} placeholder="e.g. RA/2024-25/001" />
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            }}
          >
            <div>
              <label style={labelStyle} htmlFor="grossAmount">Gross Amount (₹) *</label>
              <input id="grossAmount" style={inputStyle} type="number" required step="0.01" min="0" value={form.grossAmount} onChange={set("grossAmount")} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle} htmlFor="deductions">Deductions (₹)</label>
              <input id="deductions" style={inputStyle} type="number" step="0.01" min="0" value={form.deductions} onChange={set("deductions")} placeholder="0.00" />
            </div>
          </div>

          {netPreview !== null ? (
            <p style={{ fontSize: 13, color: "var(--ink)", margin: 0 }}>
              Net payable: <strong>{netPreview}</strong>
            </p>
          ) : null}

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
            <button
              type="button"
              onClick={() => router.push(backHref)}
              style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", cursor: "pointer" }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={busy}
              style={{ minHeight: 44, padding: "10px 24px" }}
            >
              {busy ? "Creating…" : "Generate Bill"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

export default function NewBillPage() {
  return (
    <Suspense>
      <NewBillForm />
    </Suspense>
  );
}
