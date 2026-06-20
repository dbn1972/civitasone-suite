"use client";

import { useState } from "react";

export function JournalEntryForm() {
  const [voucherNo, setVoucherNo] = useState("");
  const [narration, setNarration] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!voucherNo.trim() || !narration.trim()) {
      setStatus("error");
      setMessage("Voucher number and narration are required.");
      return;
    }

    setStatus("submitting");
    setMessage("");

    const today = new Date().toISOString().slice(0, 10);
    const body = {
      voucherNo: voucherNo.trim(),
      type: "journal" as const,
      postingDate: today,
      lines: [
        { accountCode: "1000", debitMinor: 10000, creditMinor: 0 },
        { accountCode: "2000", debitMinor: 0, creditMinor: 10000 },
      ],
    };

    try {
      const res = await fetch("/api/proxy/v1/finance/journals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }
      setStatus("accepted");
      setMessage("Journal entry accepted for processing (202).");
      setVoucherNo("");
      setNarration("");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={handleSubmit}>
      <input
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        placeholder="Voucher Number"
        value={voucherNo}
        onChange={(e) => setVoucherNo(e.target.value)}
        aria-label="Voucher Number"
      />
      <input
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        placeholder="Narration"
        value={narration}
        onChange={(e) => setNarration(e.target.value)}
        aria-label="Narration"
      />
      <button
        type="submit"
        disabled={status === "submitting"}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {status === "submitting" ? "Submitting…" : "Post Journal"}
      </button>
      {message ? (
        <p className={`text-sm ${status === "error" ? "text-red-600" : "text-emerald-700"}`}>{message}</p>
      ) : null}
    </form>
  );
}
