"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Structure = { id: string; name: string };

type Props = {
  structures: Structure[];
};

export function CreatePayrollRunForm({ structures }: Props) {
  const router = useRouter();
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(defaultMonth);
  const [structureId, setStructureId] = useState(structures[0]?.id ?? "");
  const [runNo, setRunNo] = useState(`RUN/${defaultMonth.replace("-", "/")}`);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!structureId || !runNo || !month) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/payroll/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runNo, month, structureId }),
      });
      const text = await res.text();
      if (!res.ok) {
        setMessage(text || `Create failed (${res.status})`);
        return;
      }
      const body = JSON.parse(text) as { id?: string };
      if (body.id) router.push(`/hr/payroll/${body.id}`);
      else router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  if (structures.length === 0) return null;

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <h2 className="text-sm font-semibold text-slate-800">Create Payroll Run</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          <span className="block text-slate-600 mb-1">Month</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="block text-slate-600 mb-1">Run No</span>
          <input value={runNo} onChange={(e) => setRunNo(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="block text-slate-600 mb-1">Pay Structure</span>
          <select value={structureId} onChange={(e) => setStructureId(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white">
            {structures.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      </div>
      <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
        {busy ? "Creating…" : "Create Run"}
      </button>
      {message ? <p className="text-sm text-red-600">{message}</p> : null}
      <p className="text-xs text-slate-500">
        After creation, open the run to approve and disburse.{" "}
        <Link href="/hr/leave/approvals" className="text-indigo-600 hover:underline">Leave approvals</Link>
      </p>
    </form>
  );
}
