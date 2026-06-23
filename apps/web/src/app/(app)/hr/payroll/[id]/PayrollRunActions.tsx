"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  runId: string;
  status: string;
};

export function PayrollRunActions({ runId, status }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "disburse" | null>(null);
  const [message, setMessage] = useState("");

  async function act(action: "approve" | "disburse") {
    setBusy(action);
    setMessage("");
    const path = action === "approve"
      ? `/api/proxy/v1/payroll/runs/${runId}/approve`
      : `/api/proxy/v1/payroll/runs/${runId}/disburse`;
    try {
      const res = await fetch(path, { method: "PATCH" });
      const text = await res.text();
      if (!res.ok) {
        setMessage(text || `${action} failed (${res.status})`);
        return;
      }
      setMessage(`Payroll run ${action} accepted.`);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(null);
    }
  }

  const canApprove = status === "processing" || status === "draft";
  const canDisburse = status === "completed";

  if (!canApprove && !canDisburse) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-800">Payroll Actions</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {canApprove ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act("approve")}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {busy === "approve" ? "Approving…" : "Approve Run"}
          </button>
        ) : null}
        {canDisburse ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act("disburse")}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {busy === "disburse" ? "Disbursing…" : "Disburse Run"}
          </button>
        ) : null}
      </div>
      {message ? <p className="mt-2 text-sm text-slate-600">{message}</p> : null}
    </section>
  );
}
