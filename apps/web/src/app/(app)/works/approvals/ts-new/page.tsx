"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader, Button, Field, Input, Select, Textarea, EntityPicker } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { recentFinancialYears } from "@/lib/fiscalYear";
import { searchWorkProposals, resolveWorkProposals } from "@/lib/entityAdapters/workProposal";
import { searchIdentityUsers, resolveIdentityUsers } from "@/lib/entityAdapters/identityUser";

// Token-based banner styles (no hard-coded hex).
const okBanner: React.CSSProperties = { background: "var(--good-bg, #ecfdf3)", color: "var(--good, #166534)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 };
const errBanner: React.CSSProperties = { background: "var(--bad-bg, #fef2f2)", color: "var(--bad, #b42318)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 };
const infoBanner: React.CSSProperties = { background: "var(--info-bg, #eff6ff)", color: "var(--info, #1e40af)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 };

// Upper bound: ₹999,99,99,999.99 (just under 1,000 crore) in paise.
const MAX_AMOUNT_MINOR = 99999999999n;

export default function NewTsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const srYears = recentFinancialYears(6);
  const [form, setForm] = useState({
    workId: "",
    tsNumber: "",
    tsDate: "",
    tsAuthorityId: "",
    srYear: "",
    zone: "",
    tsAmount: "",
    remarks: "",
  });
  const [amountError, setAmountError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const formError = useFormError("technical sanction");

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  function validateAmount(): string | null {
    const minor = rupeesToMinorString(form.tsAmount.trim());
    if (minor === null) {
      return "Enter a valid amount in rupees (greater than zero, up to two decimals).";
    }
    if (BigInt(minor) > MAX_AMOUNT_MINOR) {
      return "Amount is too large. Check the figure and try again.";
    }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    const amtErr = validateAmount();
    setAmountError(amtErr ?? "");
    if (amtErr) return;
    const tsAmountMinor = rupeesToMinorString(form.tsAmount.trim());
    if (tsAmountMinor === null) {
      setAmountError("Enter a valid amount in rupees (greater than zero, up to two decimals).");
      return;
    }
    setBusy(true);
    formError.clear();
    try {
      const body: Record<string, string> = {
        workId: form.workId.trim(),
        tsNumber: form.tsNumber.trim(),
        tsDate: form.tsDate,
        tsAuthorityId: form.tsAuthorityId.trim(),
        tsAmountMinor,
      };
      if (form.srYear.trim()) body.srYear = form.srYear.trim();
      if (form.zone.trim()) body.zone = form.zone.trim();
      if (form.remarks.trim()) body.remarks = form.remarks.trim();

      const res = await fetch("/api/proxy/v1/works/approvals/ts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      // The service accepts the create asynchronously (HTTP 202) — the record
      // is queued, not yet written — so we say "submitted", not "created", to
      // match the AA form and the finalize button (GAP-WORKS-APPROVALS-TS-NEW-02).
      setMessage("Technical sanction submitted. It will appear in the register once processed.");
      toast.success("Technical sanction submitted.");
      setTimeout(() => router.push("/works/approvals"), 700);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New Technical Sanction"
        subtitle="Create a Technical Sanction (TS) record for a work."
        back="/works/approvals"
        backLabel="Approvals"
      />
      <div role="note" style={infoBanner}>
        Technical sanction requires the work proposal to be DAO-finalized.
      </div>
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
          noValidate
          className="pad"
          style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}
        >
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Fields marked * are required.</p>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <Field label="Work" required id="ts-new-work-id">
              <EntityPicker
                id="ts-new-work-id"
                value={form.workId || null}
                onChange={(v) => setForm((prev) => ({ ...prev, workId: Array.isArray(v) ? (v[0] ?? "") : (v ?? "") }))}
                search={searchWorkProposals}
                resolve={resolveWorkProposals}
                placeholder="Search by work number or description…"
                aria-label="Work"
              />
            </Field>

            <Field label="TS Number" required id="ts-new-ts-number">
              <Input
                id="ts-new-ts-number"
                type="text"
                value={form.tsNumber}
                onChange={set("tsNumber")}
                placeholder="e.g. TS/2026-27/001"
                maxLength={64}
              />
            </Field>

            <Field label="Sanction date" required id="ts-new-sanction-date">
              <Input id="ts-new-sanction-date" type="date" value={form.tsDate} onChange={set("tsDate")} />
            </Field>

            <Field label="TS authority" required id="ts-new-authority-id">
              <EntityPicker
                id="ts-new-authority-id"
                value={form.tsAuthorityId || null}
                onChange={(v) =>
                  setForm((prev) => ({ ...prev, tsAuthorityId: Array.isArray(v) ? (v[0] ?? "") : (v ?? "") }))
                }
                search={searchIdentityUsers}
                resolve={resolveIdentityUsers}
                placeholder="Search by officer name…"
                aria-label="TS authority"
              />
            </Field>

            <Field label="SR Year (optional)" id="ts-new-sr-year">
              <Select id="ts-new-sr-year" value={form.srYear} onChange={set("srYear")}>
                <option value="">Select SR year…</option>
                {srYears.map((fy) => (
                  <option key={fy} value={fy}>
                    {fy}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Zone (optional)" id="ts-new-zone">
              <Input
                id="ts-new-zone"
                type="text"
                value={form.zone}
                onChange={set("zone")}
                placeholder="e.g. Central Zone, Bhubaneswar"
                maxLength={64}
              />
            </Field>

            <Field label="Sanction amount (₹)" required id="ts-new-amount" error={amountError || undefined}>
              <Input
                id="ts-new-amount"
                type="text"
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                value={form.tsAmount}
                onChange={(e) => {
                  setAmountError("");
                  set("tsAmount")(e);
                }}
                placeholder="0.00"
              />
            </Field>
          </div>

          <Field label="Remarks" id="ts-new-remarks">
            <Textarea
              id="ts-new-remarks"
              style={{ minHeight: 80 }}
              value={form.remarks}
              onChange={set("remarks")}
              maxLength={2048}
              placeholder="Optional notes or remarks"
            />
          </Field>

          <div style={{ display: "flex", gap: 12 }}>
            <Button type="submit" variant="primary" disabled={busy} style={{ minHeight: 44 }}>
              {busy ? "Submitting..." : "Create"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => router.push("/works/approvals")}
              disabled={busy}
              style={{ minHeight: 44 }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
