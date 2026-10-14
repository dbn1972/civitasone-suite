"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useEffect, Suspense } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader, Button, SkeletonCard } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString, minorToRupeesInput } from "@/lib/money";
import { useFormError } from "@/lib/useFormError";
import { WorkField, safeWorkId } from "../../WorkField";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errBanner = { background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;

type BillMode = "e_mb" | "abstract";
type Option = { id: string; label: string };

function NewBillForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const t = useTranslations("works.billsNew");

  const workId = safeWorkId(searchParams.get("workId")) ?? "";

  const [form, setForm] = useState({
    workId,
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
  const formError = useFormError("bill");

  // GAP-WORKS-BILLING-BILLS-NEW-01: when the work is known (the normal entry
  // path from the billing detail page), fetch its awards and finalized MBs so
  // the clerk SELECTS them instead of pasting a UUID that the Tenders list
  // never exposed. Only DO-finalized MBs are eligible to bill against.
  const [awards, setAwards] = useState<Option[] | null>(null);
  const [mbs, setMbs] = useState<Option[] | null>(null);

  const chosenWorkId = safeWorkId(form.workId) ?? "";
  useEffect(() => {
    setAwards(null);
    setMbs(null);
    if (!chosenWorkId) return;
    let cancelled = false;
    (async () => {
      try {
        const [aRes, mRes] = await Promise.all([
          fetch(`/api/proxy/v1/works/billing/${chosenWorkId}/awards`),
          fetch(`/api/proxy/v1/works/billing/${chosenWorkId}/mbs`),
        ]);
        if (!cancelled && aRes.ok) {
          const body = (await aRes.json()) as { data?: unknown };
          const rows = Array.isArray(body.data) ? body.data : [];
          const awardOpts = rows.map((r) => {
            const row = r as Record<string, unknown>;
            const agreement = row.agreementNumber ? String(row.agreementNumber) : null;
            const id = String(row.id ?? "");
            return { id, label: agreement ? `${agreement} — ${String(row.contractorName ?? "")}` : id };
          });
          setAwards(awardOpts);
          // Exactly one award: nothing to choose, preselect it.
          if (awardOpts.length === 1) setForm((prev) => (prev.awardId ? prev : { ...prev, awardId: awardOpts[0].id }));
        }
        if (!cancelled && mRes.ok) {
          const body = (await mRes.json()) as { data?: unknown };
          const rows = Array.isArray(body.data) ? body.data : [];
          const mbOpts = rows
            .map((r) => r as Record<string, unknown>)
            .filter((row) => String(row.status ?? "") === "do_finalized")
            .map((row) => ({ id: String(row.id ?? ""), label: String(row.mbNumber ?? row.id ?? "") }));
          setMbs(mbOpts);
          // Exactly one DO-finalized MB: nothing to choose, preselect it.
          if (mbOpts.length === 1) setForm((prev) => (prev.mbId ? prev : { ...prev, mbId: mbOpts[0].id }));
        }
      } catch {
        /* leave selects null → fall back to guarded text inputs */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chosenWorkId]);

  // GAP-WORKS-BILLING-BILLS-NEW-02: once an MB is chosen, read the value measured against it and what earlier bills
  // already used, so the clerk sees the ceiling the server will enforce (and can start from the full available
  // amount) instead of free-typing a figure. Strings are exact bigint minor units; absent/failed -> no hint.
  const [position, setPosition] = useState<{ measured: string; billed: string; available: string } | null>(null);
  useEffect(() => {
    setPosition(null);
    const mb = form.mbId.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mb)) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/works/billing/mb/${mb}/measured-value`);
        if (!res.ok || cancelled) return;
        const d = ((await res.json()) as { data?: Record<string, unknown> }).data ?? {};
        const ok = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);
        if (ok(d.measuredValueMinor) && ok(d.billedMinor) && ok(d.availableMinor)) {
          setPosition({ measured: d.measuredValueMinor, billed: d.billedMinor, available: d.availableMinor });
        }
      } catch {
        /* the hint is optional; the server still enforces the ceiling */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.mbId]);

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  // GAP-WORKS-BILLING-BILLS-NEW-02: paise are derived with string/BigInt math
  // via toMinorStringOrNull — never Math.round(Number(x) * 100), which
  // mis-rounds values like 1.005.
  const grossMinor = rupeesToMinorString(form.grossAmount);
  const dedMinor = form.deductions.trim() ? rupeesToMinorString(form.deductions, { allowZero: true }) : "0";
  const netPreview =
    grossMinor !== null && dedMinor !== null
      ? formatMoney((BigInt(grossMinor) - BigInt(dedMinor)).toString())
      : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!safeWorkId(form.workId)) {
      setError("Select the work this bill is for.");
      return;
    }
    if (grossMinor === null || BigInt(grossMinor) <= 0n) {
      setError("Enter a valid gross amount in rupees (greater than zero, up to two decimals).");
      return;
    }
    if (dedMinor === null) {
      setError("Enter a valid deductions amount in rupees (up to two decimals).");
      return;
    }
    if (BigInt(dedMinor) < 0n) {
      setError("Deductions cannot be negative.");
      return;
    }
    if (BigInt(dedMinor) > BigInt(grossMinor)) {
      setError("Deductions cannot exceed the gross amount.");
      return;
    }
    if (position && BigInt(grossMinor) > BigInt(position.available)) {
      setError(t("exceedsAvailable", { available: formatMoney(position.available) }));
      return;
    }

    setBusy(true);
    formError.clear();
    try {
      const body: Record<string, unknown> = {
        workId: form.workId.trim(),
        awardId: form.awardId.trim(),
        mbId: form.mbId.trim(),
        billMode: form.billMode,
        billNumber: form.billNumber.trim(),
        grossAmountMinor: grossMinor,
      };
      if (form.deductions.trim()) body.deductionsMinor = dedMinor;

      const res = await fetch("/api/proxy/v1/works/billing/bills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setMessage("Bill created.");
      toast.success("Bill created.");
      setTimeout(() => router.push(`/works/billing/${safeWorkId(form.workId)}`), 600);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  const backHref = workId ? `/works/billing/${workId}` : "/works/billing";

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
            (DO&nbsp;finalized) before a bill can be raised against it. Choose the work, then its
            award and finalized MB.
          </p>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <div>
              <label style={labelStyle} htmlFor="workId">Work *</label>
              <WorkField
                id="workId"
                value={form.workId}
                locked={!!workId}
                onChange={(w) => setForm((prev) => ({ ...prev, workId: w, awardId: "", mbId: "" }))}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="awardId">Award *</label>
              {awards && awards.length > 0 ? (
                <select id="awardId" style={inputStyle} required value={form.awardId} onChange={set("awardId")}>
                  <option value="">Select an award…</option>
                  {awards.map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input id="awardId" style={inputStyle} type="text" required value={form.awardId} onChange={set("awardId")} placeholder="UUID of the award" />
                  <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{chosenWorkId ? "No awards were found for this work." : "Choose a work first; its awards will be listed here."}</p>
                </>
              )}
            </div>
            <div>
              <label style={labelStyle} htmlFor="mbId">Measurement Book *</label>
              {mbs && mbs.length > 0 ? (
                <select id="mbId" style={inputStyle} required value={form.mbId} onChange={set("mbId")}>
                  <option value="">Select a DO-finalized MB…</option>
                  {mbs.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              ) : (
                <input id="mbId" style={inputStyle} type="text" required value={form.mbId} onChange={set("mbId")} placeholder="UUID of the finalized MB" />
              )}
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
              {position ? (
                <p data-testid="mb-position" style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                  {t("position", {
                    measured: formatMoney(position.measured),
                    billed: formatMoney(position.billed),
                    available: formatMoney(position.available),
                  })}{" "}
                  {position.available !== "0" ? (
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setForm((prev) => ({ ...prev, grossAmount: minorToRupeesInput(position.available) }))}
                    >
                      {t("useAvailable")}
                    </button>
                  ) : null}
                </p>
              ) : null}
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
            <Button
              variant="ghost"
              onClick={() => router.push(backHref)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy}
              style={{ minHeight: 44, padding: "10px 24px" }}
            >
              {busy ? "Creating…" : "Generate Bill"}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}

export default function NewBillPage() {
  // GAP-WORKS-BILLING-BILLS-NEW-04: give Suspense a visible skeleton fallback
  // instead of rendering nothing while useSearchParams() suspends.
  return (
    <Suspense fallback={<SkeletonCard />}>
      <NewBillForm />
    </Suspense>
  );
}
