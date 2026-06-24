"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function InstallStepActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function action(verb: "run" | "skip" | "retry") {
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/install/steps/${id}/${verb}`, { method: "PATCH" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex gap-2">
      <button className="btn primary" disabled={busy || status === "completed"} onClick={() => void action("run")}>Run</button>
      <button className="btn ghost" disabled={busy || status === "completed"} onClick={() => void action("retry")}>Retry</button>
      <button className="btn ghost" disabled={busy || status === "completed"} onClick={() => void action("skip")}>Skip</button>
    </div>
  );
}
