"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { validateGstin, validatePan, validateIfsc, validateEmail, validatePhone } from "../../_components/validators";
import { toHumanError } from "@/lib/messages";

type Errors = Partial<Record<"name" | "gstin" | "pan" | "email" | "phone" | "ifsc", string>>;

export function RegisterVendorForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [gstin, setGstin] = useState("");
  const [pan, setPan] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  function validate(): Errors {
    const e: Errors = {};
    if (!name.trim()) e.name = "Vendor name is required.";
    const g = validateGstin(gstin); if (g) e.gstin = g;
    const p = validatePan(pan); if (p) e.pan = p;
    const em = validateEmail(email); if (em) e.email = em;
    const ph = validatePhone(phone); if (ph) e.phone = ph;
    const i = validateIfsc(ifsc); if (i) e.ifsc = i;
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
          gstin: gstin.trim().toUpperCase() || undefined,
          pan: pan.trim().toUpperCase() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          ifsc: ifsc.trim().toUpperCase() || undefined,
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
      router.push("/procurement/vendors");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  function fieldError(key: keyof Errors, id: string) {
    return errors[key] ? (
      <span id={`${id}-err`} role="alert" style={{ color: "#b91c1c", fontSize: "0.78rem", marginTop: 4 }}>
        {errors[key]}
      </span>
    ) : null;
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 640 }} noValidate>
      <div className="fields">
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="name">Vendor name *</label>
          <input id="name" className="inp" value={name} onChange={(e) => setName(e.target.value)}
            aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-err" : undefined} required style={{ minHeight: 44 }} />
          {fieldError("name", "name")}
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="gstin">GSTIN</label>
          <input id="gstin" className="inp" value={gstin} onChange={(e) => setGstin(e.target.value)}
            onBlur={() => setErrors((p) => ({ ...p, gstin: validateGstin(gstin) ?? undefined }))}
            aria-invalid={!!errors.gstin} aria-describedby={errors.gstin ? "gstin-err" : undefined}
            placeholder="22AAAAA0000A1Z5" autoCapitalize="characters" style={{ minHeight: 44 }} />
          {fieldError("gstin", "gstin")}
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="pan">PAN</label>
          <input id="pan" className="inp" value={pan} onChange={(e) => setPan(e.target.value)}
            onBlur={() => setErrors((p) => ({ ...p, pan: validatePan(pan) ?? undefined }))}
            aria-invalid={!!errors.pan} aria-describedby={errors.pan ? "pan-err" : undefined}
            placeholder="ABCDE1234F" autoCapitalize="characters" style={{ minHeight: 44 }} />
          {fieldError("pan", "pan")}
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" className="inp" value={email} onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setErrors((p) => ({ ...p, email: validateEmail(email) ?? undefined }))}
            aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-err" : undefined} style={{ minHeight: 44 }} />
          {fieldError("email", "email")}
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="phone">Phone</label>
          <input id="phone" type="tel" inputMode="numeric" className="inp" value={phone} onChange={(e) => setPhone(e.target.value)}
            onBlur={() => setErrors((p) => ({ ...p, phone: validatePhone(phone) ?? undefined }))}
            aria-invalid={!!errors.phone} aria-describedby={errors.phone ? "phone-err" : undefined}
            placeholder="10-digit number" style={{ minHeight: 44 }} />
          {fieldError("phone", "phone")}
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="ifsc">Bank IFSC</label>
          <input id="ifsc" className="inp" value={ifsc} onChange={(e) => setIfsc(e.target.value)}
            onBlur={() => setErrors((p) => ({ ...p, ifsc: validateIfsc(ifsc) ?? undefined }))}
            aria-invalid={!!errors.ifsc} aria-describedby={errors.ifsc ? "ifsc-err" : undefined}
            placeholder="SBIN0001234" autoCapitalize="characters" style={{ minHeight: 44 }} />
          {fieldError("ifsc", "ifsc")}
        </div>
      </div>
      <div role="status" aria-live="polite" style={{ minHeight: 0 }}>
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, color: status === "error" ? "#b91c1c" : "#047857", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Registering…" : "Register vendor"}
        </button>
        <Link href="/procurement/vendors" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
