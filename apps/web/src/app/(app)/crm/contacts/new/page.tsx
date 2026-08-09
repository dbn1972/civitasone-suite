"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { DuplicateCheckPanel } from "../../../../_components/crm/DuplicateCheckPanel";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader } from "@/app/_components/ds";
import {
  duplicateCheck,
  parseFieldError,
  type DuplicateCandidate,
  type ValidatedField,
} from "@/lib/crm/dataQuality";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errStyle = { fontSize: 12, color: "#b42318", marginTop: 4 } as const;

type FieldErrors = Partial<Record<ValidatedField, string>>;

/** A row of GET /v1/crm/lead-field-rules — only what this form needs (LM-001). */
type LeadFieldRule = { fieldName?: string; required?: boolean; enabled?: boolean };

export default function NewContactPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "", email: "", phone: "", company: "", designation: "", city: "",
    gstin: "", pan: "", pincode: "",
    leadStatus: "new", leadSource: "", marketingConsent: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(false);
  const [ackDuplicates, setAckDuplicates] = useState(false);
  // Monotonic id so a slower earlier duplicate-check can't clobber a newer one.
  const checkSeq = useRef(0);

  // Which fields this tenant has declared mandatory. The server enforces them with
  // 422; without asking for the configuration the form would let the user type a
  // whole lead before finding out. `name` is always required by the API schema.
  const [required, setRequired] = useState<ReadonlySet<string>>(new Set(["name"]));

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/crm/lead-field-rules");
        if (!res.ok) return;
        const body = await res.json() as { data?: LeadFieldRule[] };
        if (!live) return;
        const names = (body.data ?? [])
          .filter((r) => r.required === true && r.enabled !== false)
          .map((r) => r.fieldName)
          .filter((n): n is string => typeof n === "string" && n.length > 0);
        setRequired(new Set(["name", ...names]));
      } catch {
        // Configuration is an enhancement, never a gate: if this read fails the form
        // still submits and the server still enforces. Falling back to "name only"
        // keeps the page usable offline instead of blocking lead capture.
      }
    })();
    return () => { live = false; };
  }, []);

  /** Label text carries the asterisk so screen readers announce it, not just sighted
   *  users — the visual star must never be the only signal (WCAG 2.2 AA, 1.3.1). */
  function labelFor(field: string, text: string): string {
    return required.has(field) ? `${text} *` : text;
  }

  /** `required` + `aria-required` together: native validation plus an explicit
   *  programmatic signal, since some screen readers do not surface `required`. */
  function requiredProps(field: string): { required: boolean; "aria-required": "true" | "false" } {
    const isRequired = required.has(field);
    return { required: isRequired, "aria-required": isRequired ? "true" : "false" };
  }

  /**
   * Update a field that feeds duplicate detection. Any prior "continue anyway"
   * acknowledgement and any stale candidate list are invalidated, so a later
   * edit re-triggers the DQ-001 check instead of silently skipping it.
   */
  function setDedupField(patch: Partial<typeof form>) {
    setForm((f) => ({ ...f, ...patch }));
    setAckDuplicates(false);
    setCandidates([]);
    setCheckError(false);
  }

  // Stable, useId-linked error ids for aria-describedby (DQ-003).
  const phoneErrId = useId();
  const gstinErrId = useId();
  const panErrId = useId();
  const pincodeErrId = useId();
  const errIdFor: Record<ValidatedField, string> = {
    phone: phoneErrId, gstin: gstinErrId, pan: panErrId, pincode: pincodeErrId,
  };

  async function runDuplicateCheck(): Promise<DuplicateCandidate[]> {
    if (!form.name && !form.email && !form.phone && !form.gstin && !form.pan) return [];
    const seq = ++checkSeq.current;
    setChecking(true);
    setCheckError(false);
    try {
      const found = await duplicateCheck({
        name: form.name || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        company: form.company || undefined,
        gstin: form.gstin || undefined,
        pan: form.pan || undefined,
      });
      // Ignore a stale response: a later field's check already superseded this.
      if (seq === checkSeq.current) setCandidates(found);
      return found;
    } catch {
      // A failed duplicate check must never block a legitimate create — surface a
      // source="error" affordance instead of silently swallowing (DQ, finding 5).
      if (seq === checkSeq.current) {
        setCandidates([]);
        setCheckError(true);
      }
      return [];
    } finally {
      if (seq === checkSeq.current) setChecking(false);
    }
  }

  async function create() {
    setBusy(true);
    setMessage("");
    setError("");
    setFieldErrors({});
    try {
      const res = await fetch("/api/proxy/v1/crm/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email || undefined,
          phone: form.phone || undefined,
          company: form.company || undefined,
          designation: form.designation || undefined,
          city: form.city || undefined,
          gstin: form.gstin || undefined,
          pan: form.pan || undefined,
          pincode: form.pincode || undefined,
          leadStatus: form.leadStatus,
          leadSource: form.leadSource || undefined,
          marketingConsent: form.marketingConsent,
        }),
      });
      // Read the body exactly ONCE. A DQ-003 format error is surfaced against its
      // field; anything else (including the LM-001 422 "missing mandatory field(s)"
      // message) falls through to the page-level error banner.
      const body = (await res.json().catch(() => null)) as { id?: string; code?: string; message?: string } | null;
      if (!res.ok) {
        const fe = parseFieldError({ code: body?.code, message: body?.message });
        if (fe) {
          setFieldErrors({ [fe.field]: fe.message });
        } else {
          setError(body?.message ?? body?.code ?? "Could not create the contact.");
        }
        return;
      }
      setMessage("Contact created.");
      toast.success("Contact created successfully.");
      if (body?.id) setTimeout(() => router.push(`/crm/contacts/${body.id}`), 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the contact.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // DQ-001: check for potential duplicates before saving.
    if (!ackDuplicates) {
      const found = await runDuplicateCheck();
      if (found.length > 0) return; // show the panel; wait for the clerk's choice
    }
    await create();
  }

  const describedBy = (field: ValidatedField) => (fieldErrors[field] ? errIdFor[field] : undefined);

  return (
    <>
      <PageHeader title="New Contact" subtitle="Lead capture with duplicate detection and consent tracking." back="/crm/contacts" backLabel="Contacts" />
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      {error ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{error}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          {/* Explains the asterisk convention in text, so the marker is never the
              only way to know a field is mandatory. */}
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
            Fields marked * are required by your organisation.
          </p>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div>
              <label htmlFor="new-name" style={labelStyle}>{labelFor("name", "Full name")}</label>
              <input id="new-name" {...requiredProps("name")} value={form.name} onChange={(e) => setDedupField({ name: e.target.value })} placeholder="e.g. Asha Rao" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="new-email" style={labelStyle}>{labelFor("email", "Email")}</label>
              <input id="new-email" type="email" {...requiredProps("email")} value={form.email} onChange={(e) => setDedupField({ email: e.target.value })} onBlur={() => void runDuplicateCheck()} placeholder="name@example.com" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="new-phone" style={labelStyle}>{labelFor("phone", "Phone (mobile)")}</label>
              <input
                id="new-phone"
                {...requiredProps("phone")}
                value={form.phone}
                onChange={(e) => setDedupField({ phone: e.target.value })}
                onBlur={() => void runDuplicateCheck()}
                placeholder="9900000000"
                style={inputStyle}
                aria-invalid={fieldErrors.phone ? true : undefined}
                aria-describedby={describedBy("phone")}
              />
              {fieldErrors.phone ? <p id={phoneErrId} role="alert" style={errStyle}>{fieldErrors.phone}</p> : null}
            </div>
            <div>
              <label htmlFor="new-company" style={labelStyle}>{labelFor("company", "Organisation")}</label>
              <input id="new-company" {...requiredProps("company")} value={form.company} onChange={(e) => setDedupField({ company: e.target.value })} onBlur={() => void runDuplicateCheck()} placeholder="Acme Corp" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="new-gstin" style={labelStyle}>GSTIN</label>
              <input
                id="new-gstin"
                value={form.gstin}
                onChange={(e) => setDedupField({ gstin: e.target.value.toUpperCase() })}
                onBlur={() => void runDuplicateCheck()}
                placeholder="29ABCDE1234F1Z5"
                style={inputStyle}
                aria-invalid={fieldErrors.gstin ? true : undefined}
                aria-describedby={describedBy("gstin")}
              />
              {fieldErrors.gstin ? <p id={gstinErrId} role="alert" style={errStyle}>{fieldErrors.gstin}</p> : null}
            </div>
            <div>
              <label htmlFor="new-pan" style={labelStyle}>PAN</label>
              <input
                id="new-pan"
                value={form.pan}
                onChange={(e) => setDedupField({ pan: e.target.value.toUpperCase() })}
                placeholder="ABCDE1234F"
                style={inputStyle}
                aria-invalid={fieldErrors.pan ? true : undefined}
                aria-describedby={describedBy("pan")}
              />
              {fieldErrors.pan ? <p id={panErrId} role="alert" style={errStyle}>{fieldErrors.pan}</p> : null}
            </div>
            <div>
              <label htmlFor="new-city" style={labelStyle}>{labelFor("city", "City")}</label>
              <input id="new-city" {...requiredProps("city")} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Bengaluru" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="new-pincode" style={labelStyle}>PIN code</label>
              <input
                id="new-pincode"
                value={form.pincode}
                onChange={(e) => setForm({ ...form, pincode: e.target.value })}
                placeholder="560001"
                inputMode="numeric"
                style={inputStyle}
                aria-invalid={fieldErrors.pincode ? true : undefined}
                aria-describedby={describedBy("pincode")}
              />
              {fieldErrors.pincode ? <p id={pincodeErrId} role="alert" style={errStyle}>{fieldErrors.pincode}</p> : null}
            </div>
            <div>
              <label htmlFor="new-designation" style={labelStyle}>{labelFor("designation", "Designation")}</label>
              <input id="new-designation" {...requiredProps("designation")} value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="Director" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="new-leadStatus" style={labelStyle}>Lead status</label>
              <select id="new-leadStatus" value={form.leadStatus} onChange={(e) => setForm({ ...form, leadStatus: e.target.value })} style={inputStyle}>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="qualified">Qualified</option>
                <option value="unqualified">Unqualified</option>
                <option value="customer">Customer</option>
              </select>
            </div>
            <div>
              <label htmlFor="new-leadSource" style={labelStyle}>{labelFor("leadSource", "Lead source")}</label>
              <input id="new-leadSource" {...requiredProps("leadSource")} value={form.leadSource} onChange={(e) => setForm({ ...form, leadSource: e.target.value })} placeholder="Website, referral…" style={inputStyle} />
            </div>
          </div>

          <DuplicateCheckPanel
            candidates={candidates}
            checking={checking}
            error={checkError}
            mergeHrefBase="/crm/contacts/"
            onMerge={(c) => router.push(`/crm/contacts/${c.id}`)}
            onContinueAnyway={() => {
              setAckDuplicates(true);
              setCandidates([]);
            }}
          />

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13 }}>
            <input type="checkbox" checked={form.marketingConsent} onChange={(e) => setForm({ ...form, marketingConsent: e.target.checked })} />
            Marketing consent (GDPR/DPDP)
          </label>
          <button type="submit" className="btn primary" disabled={busy || checking} style={{ marginTop: 16, minHeight: 44 }}>
            {busy ? "Creating…" : checking ? "Checking…" : ackDuplicates ? "Create anyway" : "Create contact"}
          </button>
        </form>
      </div>
    </>
  );
}
