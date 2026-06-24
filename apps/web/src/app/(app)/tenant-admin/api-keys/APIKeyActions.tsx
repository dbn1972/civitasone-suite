"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type KeyRow = { id: string; keyName: string; status: string };

export function APIKeyActions({ keys }: { keys: KeyRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("read");
  const [busy, setBusy] = useState(false);
  const [createdKey, setCreatedKey] = useState("");
  const [message, setMessage] = useState("");

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setCreatedKey("");
    try {
      const res = await fetch("/api/proxy/v1/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          keyName: name,
          scopes: scopes.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json() as { key?: string };
      setCreatedKey(body.key ?? "");
      setName("");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/admin/api-keys/${id}/revoke`, { method: "PATCH" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to revoke key");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h"><h3>Key Operations</h3></div>
      <form className="pad" onSubmit={createKey}>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name" style={{ width: "100%", padding: 8, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
        <input value={scopes} onChange={(e) => setScopes(e.target.value)} placeholder="Scopes, comma separated" style={{ width: "100%", padding: 8, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
        <button className="btn primary" disabled={busy}>{busy ? "Saving..." : "Create API Key"}</button>
      </form>
      {createdKey ? (
        <div className="pad" style={{ paddingTop: 0 }}>
          <p style={{ fontSize: 12, color: "#b45309" }}>Copy now. This secret is shown once.</p>
          <code style={{ display: "block", overflowWrap: "anywhere", background: "#f8fafc", padding: 10, borderRadius: 8 }}>{createdKey}</code>
        </div>
      ) : null}
      <div className="pad" style={{ paddingTop: 0 }}>
        {keys.filter((k) => k.status === "active").map((key) => (
          <div key={key.id} className="prefrow">
            <span>{key.keyName}</span>
            <button className="btn ghost" disabled={busy} onClick={() => void revoke(key.id)}>Revoke</button>
          </div>
        ))}
      </div>
      {message ? <p style={{ color: "#b91c1c", fontSize: 12, padding: "0 16px 16px" }}>{message}</p> : null}
    </div>
  );
}
