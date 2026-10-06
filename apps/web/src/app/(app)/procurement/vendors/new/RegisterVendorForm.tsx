"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  validatePan,
  validateIfsc,
  validateEmail,
  validateGstinStrict,
  validateGstinPanMatch,
  validateMobileNormalized,
  normalizePhone,
  validateAccountNo,
} from "../../_components/validators";
import { toHumanError } from "@/lib/messages";
import { useFormError } from "@/lib/useFormError";
import { Button } from "@/app/_components/ds";

type FieldKey =
  | "name" | "category" | "gstin" | "pan" | "email" | "phone"
  | "ifsc" | "accountNo" | "confirmAccountNo";
type Errors = Partial<Record<FieldKey, string>>;

const CATEGORY_OPTIONS = [
  { value: "goods", label: "Goods" },
  { value: "services", label: "Services" },
  { value: "works", label: "Works" },
] as const;

export function RegisterVendorForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [address, setAddress] = useState("");
  const [gstin, setGstin] = useState("");
  const [pan, setPan] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [confirmAccountNo, setConfirmAccountNo] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const formError = useFormError("vendor");
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  function validate(): Errors {
    const e: Errors = {};
    if (!name.trim()) e.name = "Vendor name is required.";
    if (!category) e.category = "Select a vendor category.";
    const g = validateGstinStrict(gstin); if (g) e.gstin = g;
    const p = validatePan(pan); if (p) e.pan = p;
    // GAP-...-NEW-02: when both GSTIN and PAN are present they must agree.
    if (!e.gstin && !e.pan) {
      const m = validateGstinPanMatch(gstin, pan); if (m) e.pan = m;
    }
    const em = validateEmail(email); if (em) e.email = em;
    const ph = validateMobileNormalized(phone); if (ph) e.phone = ph;
    const i = validateIfsc(ifsc); if (i) e.ifsc = i;
    const a = validateAccountNo(accountNo); if (a) e.accountNo = a;
    // GAP-...-NEW-01 / NEW-05: IFSC and account number are coupled — one
    // without the other makes an unusable, money-risky payment record.
    if (ifsc.trim() && !accountNo.trim()) e.accountNo = "Enter the account number for this IFSC.";
    if (accountNo.trim() && !ifsc.trim()) e.ifsc = "Enter the IFSC for this account number.";
    // Confirm-account-number must match (fail closed on a typo'd account).
    if (accountNo.trim() && confirmAccountNo.trim() !== accountNo.trim()) {
      e.confirmAccountNo = "Account numbers do not match.";
    }
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const eMap = validate();
    setErrors(eMap);
    if (Object.keys(eMap).length > 0) {
      setStatus("error");
      setMessage("Please correct the highlighted fields.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/procurement/vendors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          category,
          contactPerson: contactPerson.trim() || undefined,
          address: address.trim() || undefined,
          gstin: gstin.trim().toUpperCase() || undefined,
          pan: pan.trim().toUpperCase() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() ? normalizePhone(phone) : undefined,
          ifsc: ifsc.trim().toUpperCase() || undefined,
          bankAccountNo: accountNo.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const human = toHumanError("save", { area: "vendor" });
        setStatus("error");
        setMessage(`${human.what} ${human.next}`);
        return;
      }
      setStatus("accepted");
      setMessage("Vendor registration accepted.");
      // GAP-...-NEW-03: land on the new vendor's profile with a confirmation
      // banner + initial status, instead of flashing a message then
      // redirecting away so it is never read. Use the id from the response.
      let newId: string | undefined;
      try {
        const body: unknown = await res.json();
        if (body && typeof body === "object" && "id" in body) {
          const v = (body as { id?: unknown }).id;
          if (typeof v === "string") newId = v;
        }
      } catch { /* ignore — fall back to the list */ }
      if (newId) {
        router.push(`/procurement/vendors/${newId}?registered=1`);
      } else {
        router.push("/procurement/vendors");
      }
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(formError.fromException("save", err).message);
    }
  }

  function fieldError(key: FieldKey, id: string) {
    return errors[key] ? (
      <span id={`${id}-err`} role="alert" className="field-err" style={{ color: "var(--bad)", fontSize: "0.78rem", marginTop: 4 }}>
        {errors[key]}
      </span>
    ) : null;
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 640 }} noValidate>
      {/* GAP-...-NEW-03: DPDP collection notice — purpose, retention, grievance. */}
      <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 16 }}>
        PAN, email, phone and bank details are collected for vendor onboarding,
        payment and statutory reporting only, retained for the empanelment period
        as required by records-retention rules, and never shared beyond those
        purposes. For any grievance, contact your procurement office.{" "}
        <Link href="/help/privacy">Privacy policy</Link>.
      </p>
      <div className="fields">
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="name">Vendor name *</label>
          <input id="name" className="inp" value={name} onChange={(e) => setName(e.target.value)}
            aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-err" : undefined} required style={{ minHeight: 44 }} />
          {fieldError("name", "name")}
        </div>
        <div className="field">
          <label className="label" htmlFor="category">Category *</label>
          <select id="category" className="inp" value={category} onChange={(e) => setCategory(e.target.value)}
            aria-invalid={!!errors.category} aria-describedby={errors.category ? "category-err" : undefined} style={{ minHeight: 44 }}>
            <option value="">Select…</option>
            {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          {fieldError("category", "category")}
        </div>
        <div className="field">
          <label className="label" htmlFor="contactPerson">Contact person</label>
          <input id="contactPerson" className="inp" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} style={{ minHeight: 44 }} />
        </div>
        <div className="field">
          <label className="label" htmlFor="gstin">GSTIN</label>
          <input id="gstin" className="inp" value={gstin} onChange={(e) => setGstin(e.target.value)}
            onBlur={() => setErrors((p) => ({ ...p, gstin: validateGstinStrict(gstin) ?? undefined }))}
            aria-invalid={!!errors.gstin} aria-describedby={errors.gstin ? "gstin-err" : undefined}
            placeholder="22AAAAA0000A1Z5" autoCapitalize="characters" style={{ minHeight: 44 }} />
          {fieldError("gstin", "gstin")}
        </div>
        <div className="field">
          <label className="label" htmlFor="pan">PAN</label>
          <input id="pan" className="inp" value={pan} onChange={(e) => setPan(e.target.value)}
            onBlur={() => setErrors((p) => ({ ...p, pan: validatePan(pan) ?? undefined }))}
            aria-invalid={!!errors.pan} aria-describedby={errors.pan ? "pan-err" : undefined}
            placeholder="ABCDE1234F" autoCapitalize="characters" style={{ minHeight: 44 }} />
          {fieldError("pan", "pan")}
        </div>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" className="inp" value={email} onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setErrors((p) => ({ ...p, email: validateEmail(email) ?? undefined }))}
            aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-err" : undefined} style={{ minHeight: 44 }} />
          {fieldError("email", "email")}
        </div>
        <div className="field">
          <label className="label" htmlFor="phone">Phone</label>
          <input id="phone" type="tel" inputMode="numeric" className="inp" value={phone} onChange={(e) => setPhone(e.target.value)}
            onBlur={() => setErrors((p) => ({ ...p, phone: validateMobileNormalized(phone) ?? undefined }))}
            aria-invalid={!!errors.phone} aria-describedby={errors.phone ? "phone-err" : undefined}
            placeholder="+91 or 10-digit mobile" style={{ minHeight: 44 }} />
          {fieldError("phone", "phone")}
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="address">Address</label>
          <textarea id="address" className="inp" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} style={{ minHeight: 44 }} />
        </div>
        <div className="field">
          <label className="label" htmlFor="ifsc">Bank IFSC</label>
          <input id="ifsc" className="inp" value={ifsc} onChange={(e) => setIfsc(e.target.value)}
            onBlur={() => setErrors((p) => ({ ...p, ifsc: validateIfsc(ifsc) ?? undefined }))}
            aria-invalid={!!errors.ifsc} aria-describedby={errors.ifsc ? "ifsc-err" : undefined}
            placeholder="SBIN0001234" autoCapitalize="characters" style={{ minHeight: 44 }} />
          {fieldError("ifsc", "ifsc")}
        </div>
        <div className="field">
          <label className="label" htmlFor="accountNo">Bank account number</label>
          <input id="accountNo" className="inp" inputMode="numeric" value={accountNo} onChange={(e) => setAccountNo(e.target.value)}
            onBlur={() => setErrors((p) => ({ ...p, accountNo: validateAccountNo(accountNo) ?? undefined }))}
            aria-invalid={!!errors.accountNo} aria-describedby={errors.accountNo ? "accountNo-err" : undefined}
            placeholder="9–18 digits" autoComplete="off" style={{ minHeight: 44 }} />
          {fieldError("accountNo", "accountNo")}
        </div>
        <div className="field">
          <label className="label" htmlFor="confirmAccountNo">Confirm account number</label>
          <input id="confirmAccountNo" className="inp" inputMode="numeric" value={confirmAccountNo} onChange={(e) => setConfirmAccountNo(e.target.value)}
            aria-invalid={!!errors.confirmAccountNo} aria-describedby={errors.confirmAccountNo ? "confirmAccountNo-err" : undefined}
            autoComplete="off" onPaste={(e) => e.preventDefault()} style={{ minHeight: 44 }} />
          {fieldError("confirmAccountNo", "confirmAccountNo")}
        </div>
      </div>
      <div role="status" aria-live="polite" style={{ minHeight: 0 }}>
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, color: status === "error" ? "var(--bad)" : "var(--good)", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Registering…" : "Register vendor"}
        </Button>
        <Link href="/procurement/vendors" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
