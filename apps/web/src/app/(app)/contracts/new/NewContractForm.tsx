"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

const CONTRACT_TYPES = [
  { value: "service", label: "Service" },
  { value: "supply", label: "Supply" },
  { value: "maintenance", label: "Maintenance" },
] as const;

export function NewContractForm() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [partyName, setPartyName] = useState("");
  const [contractType, setContractType] = useState<string>("service");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");

  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const titleId = useId();
  const partyId = useId();
  const typeId = useId();
  const startId = useId();
  const endId = useId();
  const valueId = useId();
  const descId = useId();
  const statusMsgId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!title.trim() || !partyName.trim()) {
      setStatus("error");
      setMessage("Title and party name are required.");
      return;
    }

    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      setStatus("error");
      setMessage("End date cannot be before start date.");
      return;
    }

    setStatus("submitting");
    setMessage("");

    try {
      const res = await fetch("/api/proxy/v1/contract/contracts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          partyName: partyName.trim(),
          contractType,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          value: value ? Number(value) : undefined,
          description: description.trim() || undefined,
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }

      setStatus("success");
      setMessage("Contract created successfully.");
      router.push("/contracts/list");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm max-w-2xl"
      aria-describedby={message ? statusMsgId : undefined}
      noValidate
    >
      <div>
        <label htmlFor={titleId} className="block text-sm font-medium text-slate-700 mb-1">
          Title <span aria-hidden="true">*</span>
        </label>
        <input
          id={titleId}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Annual IT Maintenance"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
          aria-required="true"
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor={partyId} className="block text-sm font-medium text-slate-700 mb-1">
          Party Name <span aria-hidden="true">*</span>
        </label>
        <input
          id={partyId}
          type="text"
          value={partyName}
          onChange={(e) => setPartyName(e.target.value)}
          placeholder="e.g. TechCorp Solutions Pvt Ltd"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
          aria-required="true"
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor={typeId} className="block text-sm font-medium text-slate-700 mb-1">
          Contract Type
        </label>
        <select
          id={typeId}
          value={contractType}
          onChange={(e) => setContractType(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {CONTRACT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label htmlFor={startId} className="block text-sm font-medium text-slate-700 mb-1">
            Start Date
          </label>
          <input
            id={startId}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label htmlFor={endId} className="block text-sm font-medium text-slate-700 mb-1">
            End Date
          </label>
          <input
            id={endId}
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div>
        <label htmlFor={valueId} className="block text-sm font-medium text-slate-700 mb-1">
          Value (₹)
        </label>
        <input
          id={valueId}
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 500000"
          min="0"
          step="1"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          inputMode="numeric"
        />
      </div>

      <div>
        <label htmlFor={descId} className="block text-sm font-medium text-slate-700 mb-1">
          Description
        </label>
        <textarea
          id={descId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Scope, terms, and conditions…"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
        />
      </div>

      <button
        type="submit"
        disabled={status === "submitting"}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
        style={{ minHeight: 44, minWidth: 44 }}
      >
        {status === "submitting" ? "Creating…" : "Create Contract"}
      </button>

      {message && (
        <p
          id={statusMsgId}
          role={status === "error" ? "alert" : "status"}
          aria-live={status === "error" ? "assertive" : "polite"}
          className={`text-sm ${status === "error" ? "text-red-600" : "text-emerald-700"}`}
        >
          <span className="font-semibold">{status === "error" ? "Error: " : "Success: "}</span>
          {message}
        </p>
      )}
    </form>
  );
}
