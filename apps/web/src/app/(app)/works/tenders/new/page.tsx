"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader, Button, EntityPicker } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { searchWorkProposals, resolveWorkProposals } from "@/lib/entityAdapters/workProposal";

const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errBanner = { background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;

interface TenderTypeOption {
  id: string;
  name: string;
  code?: string | null;
}

export default function NewTenderPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [workId, setWorkId] = useState<string | null>(null);
  const [form, setForm] = useState({
    referenceNumber: "",
    tenderType: "",
    tenderCategory: "",
    openingDate: "",
    bidValidity: "",
    fees: "",
  });
  const [tenderTypes, setTenderTypes] = useState<TenderTypeOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const formError = useFormError("pre-tender");

  // GAP-WORKS-TENDERS-NEW-03: load the tender-types master so the select
  // offers real master options (not a hand-coded enum that drifts from the
  // register's master vocabulary). Degrades to an empty list on any failure.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/proxy/v1/works/masters/tender-types?pageSize=200")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data?: TenderTypeOption[] } | null) => {
        if (!cancelled && body?.data) setTenderTypes(body.data);
      })
      .catch(() => {
        /* leave empty — the field shows only the placeholder */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    formError.clear();
    // GAP-WORKS-TENDERS-NEW-01: a work must be chosen from the register.
    if (!workId) {
      setError("Select the work this tender belongs to.");
      return;
    }
    // GAP-WORKS-TENDERS-NEW-05: validate the fee without float math; reject 0.
    let feesMinor: string | null = null;
    if (form.fees.trim()) {
      feesMinor = rupeesToMinorString(form.fees);
      if (feesMinor === null) {
        setError("Enter a valid tender fee in rupees (greater than 0, up to 2 decimals), or leave it blank.");
        return;
      }
    }
    // bid validity: positive integer, capped (also enforced server-side).
    let bidValidity: number | undefined;
    if (form.bidValidity.trim()) {
      const n = parseInt(form.bidValidity, 10);
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        setError("Bid validity must be between 1 and 365 days.");
        return;
      }
      bidValidity = n;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { workId };
      if (form.referenceNumber.trim()) body.referenceNumber = form.referenceNumber.trim();
      if (form.tenderType) body.tenderType = form.tenderType;
      if (form.tenderCategory.trim()) body.tenderCategory = form.tenderCategory.trim();
      if (form.openingDate) body.openingDate = new Date(form.openingDate).toISOString();
      if (bidValidity !== undefined) body.bidValidity = bidValidity;
      if (feesMinor !== null) body.fees = feesMinor;

      const res = await fetch("/api/proxy/v1/works/tenders/pre-tender", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setMessage("Created.");
      toast.success("Pre-tender created.");
      setTimeout(() => router.push("/works/tenders"), 600);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-main wrap">
      {/* GAP-WORKS-TENDERS-NEW-04: back link + subtitle + DS layout like siblings. */}
      <PageHeader
        title="New Pre-Tender"
        subtitle="Record a pre-tender against a sanctioned work."
        back="/works/tenders"
        backLabel="Tenders"
      />
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24, maxWidth: 640 }}>
        {/* GAP-WORKS-TENDERS-NEW-04: announce submit errors to assistive tech. */}
        {error && <div style={errBanner} role="alert" aria-live="assertive">{error}</div>}
        {message && <div style={okBanner} role="status" aria-live="polite">{message}</div>}

        <div>
          <label style={labelStyle} htmlFor="workId">Work <span aria-hidden>*</span></label>
          {/* GAP-WORKS-TENDERS-NEW-01: pick a work by number/description instead
              of pasting a UUID; stores the id, shows a label. */}
          <EntityPicker
            id="workId"
            aria-label="Work"
            value={workId}
            onChange={(v) => setWorkId(Array.isArray(v) ? v[0] ?? null : v)}
            search={searchWorkProposals}
            resolve={resolveWorkProposals}
            placeholder="Search by work number or description…"
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="referenceNumber">Reference number</label>
          <input id="referenceNumber" name="referenceNumber" className="input" value={form.referenceNumber} onChange={handleChange} placeholder="e.g. NIT/2024-25/001" maxLength={128} />
        </div>

        <div>
          <label style={labelStyle} htmlFor="tenderType">Tender type</label>
          <select id="tenderType" name="tenderType" className="input" value={form.tenderType} onChange={handleChange}>
            <option value="">— Select —</option>
            {tenderTypes.map((t) => (
              <option key={t.id} value={t.code ?? t.name}>{t.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle} htmlFor="tenderCategory">Tender category</label>
          <input id="tenderCategory" name="tenderCategory" className="input" value={form.tenderCategory} onChange={handleChange} placeholder="e.g. Civil, Electrical" maxLength={64} />
        </div>

        <div>
          <label style={labelStyle} htmlFor="openingDate">Opening date</label>
          <input id="openingDate" name="openingDate" type="date" className="input" value={form.openingDate} onChange={handleChange} />
        </div>

        <div>
          <label style={labelStyle} htmlFor="bidValidity">Bid validity (days)</label>
          <input id="bidValidity" name="bidValidity" type="number" min={1} max={365} className="input" value={form.bidValidity} onChange={handleChange} />
        </div>

        <div>
          <label style={labelStyle} htmlFor="fees">Tender fee (₹)</label>
          <input id="fees" name="fees" type="text" inputMode="decimal" className="input" value={form.fees} onChange={handleChange} placeholder="e.g. 500.00" />
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
          <Button variant="ghost" onClick={() => router.push("/works/tenders")} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Create Pre-Tender"}
          </Button>
        </div>
      </form>
    </div>
  );
}
