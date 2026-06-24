"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Plugin = { id?: string; name: string; status: string };

export function PluginActions({ plugins }: { plugins: Plugin[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function action(plugin: Plugin, verb: "install" | "enable" | "disable") {
    if (!plugin.id) return;
    setBusy(plugin.id);
    setMessage("");
    try {
      const method = verb === "install" ? "POST" : "PATCH";
      const res = await fetch(`/api/proxy/v1/plugins/items/${plugin.id}/${verb}`, { method });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="space-y-3">
        {plugins.map((plugin) => (
          <article key={plugin.id ?? plugin.name} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <span className="font-medium text-slate-900">{plugin.name}</span>
              <div className="text-xs text-slate-500">{plugin.status}</div>
            </div>
            <div className="flex gap-2">
              <button className="btn primary" disabled={busy === plugin.id} onClick={() => void action(plugin, "install")}>Install</button>
              <button className="btn ghost" disabled={busy === plugin.id} onClick={() => void action(plugin, "enable")}>Enable</button>
              <button className="btn ghost" disabled={busy === plugin.id} onClick={() => void action(plugin, "disable")}>Disable</button>
            </div>
          </article>
        ))}
      </div>
      {message ? <p className="mt-3 text-sm text-red-700">{message}</p> : null}
    </>
  );
}
