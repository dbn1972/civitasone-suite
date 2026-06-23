"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RegisterVendorForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [gstin, setGstin] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setStatus("error");
      setMessage("Vendor name is required.");
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
          gstin: gstin.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
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

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 640 }}>
      <div className="fields">
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="name">Vendor name</label>
          <input id="name" className="inp" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="gstin">GSTIN</label>
          <input id="gstin" className="inp" value={gstin} onChange={(e) => setGstin(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" className="inp" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="phone">Phone</label>
          <input id="phone" className="inp" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      {message ? <p style={{ marginTop: 12, color: status === "error" ? "#b91c1c" : "#047857", fontSize: "0.875rem" }}>{message}</p> : null}
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" disabled={status === "submitting"}>
          {status === "submitting" ? "Registering…" : "Register vendor"}
        </button>
        <Link href="/procurement/vendors" className="btn ghost">Cancel</Link>
      </div>
    </form>
  );
}
