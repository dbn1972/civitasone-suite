"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Module = { moduleKey: string; moduleName: string; enabled: boolean };

export function ModuleToggleActions({ modules }: { modules: Module[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function toggle(moduleKey: string, enabled: boolean) {
    setBusy(moduleKey);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/admin/tenant/modules/${moduleKey}/toggle`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to update module");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {modules.map((mod) => (
        <div key={mod.moduleKey} className="prefrow">
          <div>
            <div style={{ fontWeight: 500, fontSize: 14 }}>{mod.moduleName}</div>
            <div style={{ fontSize: 12, color: "#98a2b3" }}><span className="mono">{mod.moduleKey}</span></div>
          </div>
          <button className={`btn ${mod.enabled ? "ghost" : "primary"}`} disabled={busy === mod.moduleKey} onClick={() => void toggle(mod.moduleKey, !mod.enabled)}>
            {busy === mod.moduleKey ? "Saving..." : mod.enabled ? "Disable" : "Enable"}
          </button>
        </div>
      ))}
      {message ? <p style={{ color: "#b91c1c", fontSize: 12 }}>{message}</p> : null}
    </>
  );
}
