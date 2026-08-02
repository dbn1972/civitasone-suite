"use client";

import { useState } from "react";

/** Client form — POST /api/proxy/v1/policy/role-features. */
export function RoleFeatureGrantForm() {
  const [roleName, setRoleName] = useState("finance_clerk");
  const [featureKey, setFeatureKey] = useState("finance.dashboard");
  const [status, setStatus] = useState<"idle" | "pending" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("pending");
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/policy/role-features", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleName, featureKey, granted: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setMessage(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setStatus("ok");
      setMessage(body?.id ? `Accepted — id ${body.id}` : "Accepted (202)");
    } catch {
      setStatus("error");
      setMessage("Network error");
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, maxWidth: 520 }}>
      <label>
        <span>Role name</span>
        <input required value={roleName} onChange={(e) => setRoleName(e.target.value)} maxLength={100} />
      </label>
      <label>
        <span>Feature key</span>
        <input required value={featureKey} onChange={(e) => setFeatureKey(e.target.value)} maxLength={200} />
      </label>
      <button type="submit" disabled={status === "pending"}>
        {status === "pending" ? "Granting…" : "Grant feature"}
      </button>
      {message && (
        <p role="status" aria-live="polite" style={{ color: status === "error" ? "#b91c1c" : "#166534" }}>
          {message}
        </p>
      )}
    </form>
  );
}
