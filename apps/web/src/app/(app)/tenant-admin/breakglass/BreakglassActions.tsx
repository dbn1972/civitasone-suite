"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function BreakglassActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function close() {
    if (!confirm("Close this break-glass session now?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/admin/support/break-glass/${id}/close`, { method: "PATCH" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return <button className="btn ghost" disabled={busy} onClick={() => void close()}>{busy ? "Closing..." : "Revoke"}</button>;
}
