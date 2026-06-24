"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ThemeActions() {
  const router = useRouter();
  const [name, setName] = useState("Published tenant theme");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/themes/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Theme revision published.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to publish");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={publish} className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="text-sm font-medium text-slate-700">Revision name</label>
      <div className="mt-2 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <button className="btn primary" disabled={busy}>{busy ? "Publishing..." : "Publish Theme"}</button>
      </div>
      {message ? <p className="mt-2 text-sm text-slate-600">{message}</p> : null}
    </form>
  );
}
