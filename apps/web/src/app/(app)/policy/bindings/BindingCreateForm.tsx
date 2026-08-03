"use client";

import { useState } from "react";

/**
 * Client form — POST /api/proxy/v1/policy/bindings → gateway /api/v1/policy/bindings.
 */
export function BindingCreateForm() {
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [status, setStatus] = useState<"idle" | "pending" | "ok" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("pending");
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/policy/bindings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, roleId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setMessage(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setStatus("ok");
      setMessage(body?.id ? `Accepted — id ${body.id}` : "Accepted (202)");
      setUserId("");
      setRoleId("");
    } catch {
      setStatus("error");
      setMessage("Network error");
    }
  }

  return (
    <form onSubmit={onSubmit} className="form-grid" style={{ display: "grid", gap: 12, maxWidth: 520 }}>
      <label>
        <span>User ID (UUID)</span>
        <input
          required
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000001"
          pattern="[0-9a-fA-F-]{36}"
        />
      </label>
      <label>
        <span>Role ID (UUID)</span>
        <input
          required
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000001"
          pattern="[0-9a-fA-F-]{36}"
        />
      </label>
      <button type="submit" disabled={status === "pending"}>
        {status === "pending" ? "Submitting…" : "Create binding"}
      </button>
      {message && (
        <p role="status" aria-live="polite" style={{ color: status === "error" ? "#b91c1c" : "#166534" }}>
          {message}
        </p>
      )}
    </form>
  );
}
