"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function NewContractForm() {
  const router = useRouter();

  const [contractNo, setContractNo] = useState("");
  const [title, setTitle] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [expiry, setExpiry] = useState("");
  const [value, setValue] = useState("");

  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [invalidField, setInvalidField] = useState<string | null>(null);

  const contractNoId = useId();
  const titleId = useId();
  const vendorId_ = useId();
  const startId = useId();
  const expiryId = useId();
  const valueId = useId();
  const statusMsgId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!contractNo.trim()) {
      setStatus("error");
      setInvalidField("contractNo");
      setMessage("Contract number is required.");
      return;
    }
    if (!title.trim()) {
      setStatus("error");
      setInvalidField("title");
      setMessage("Title is required.");
      return;
    }
    if (!UUID_RE.test(vendorId.trim())) {
      setStatus("error");
      setInvalidField("vendorId");
      setMessage("Vendor ID must be a valid UUID.");
      return;
    }
    const parsedValue = Number(value);
    if (!value || isNaN(parsedValue) || parsedValue <= 0) {
      setStatus("error");
      setInvalidField("value");
      setMessage("Value must be a positive number.");
      return;
    }
    if (!startDate) {
      setStatus("error");
      setInvalidField("startDate");
      setMessage("Start date is required.");
      return;
    }
    if (!expiry) {
      setStatus("error");
      setInvalidField("expiry");
      setMessage("Expiry date is required.");
      return;
    }
    if (expiry < startDate) {
      setStatus("error");
      setInvalidField("expiry");
      setMessage("Expiry date must be on or after start date.");
      return;
    }

    setStatus("submitting");
    setInvalidField(null);
    setMessage("");

    try {
      const res = await fetch("/api/proxy/v1/contract/contracts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contractNo: contractNo.trim(),
          vendorId: vendorId.trim(),
          title: title.trim(),
          valueMinor: Math.round(parsedValue * 100),
          startDate,
          expiry,
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
        <label htmlFor={contractNoId} className="block text-sm font-medium text-slate-700 mb-1">
          Contract No <span aria-hidden="true">*</span>
        </label>
        <input
          id={contractNoId}
          type="text"
          value={contractNo}
          onChange={(e) => setContractNo(e.target.value)}
          placeholder="e.g. CON-2024-0007"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
          aria-required="true"
          aria-invalid={invalidField === "contractNo"}
          autoComplete="off"
        />
      </div>

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
          aria-invalid={invalidField === "title"}
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor={vendorId_} className="block text-sm font-medium text-slate-700 mb-1">
          Vendor ID (UUID) <span aria-hidden="true">*</span>
        </label>
        <input
          id={vendorId_}
          type="text"
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          placeholder="e.g. 3f2504e0-4f89-41d3-9a0c-0305e82c3301"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
          aria-required="true"
          aria-invalid={invalidField === "vendorId"}
          autoComplete="off"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label htmlFor={startId} className="block text-sm font-medium text-slate-700 mb-1">
            Start Date <span aria-hidden="true">*</span>
          </label>
          <input
            id={startId}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
            aria-required="true"
            aria-invalid={invalidField === "startDate"}
          />
        </div>
        <div>
          <label htmlFor={expiryId} className="block text-sm font-medium text-slate-700 mb-1">
            Expiry Date <span aria-hidden="true">*</span>
          </label>
          <input
            id={expiryId}
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
            aria-required="true"
            aria-invalid={invalidField === "expiry"}
          />
        </div>
      </div>

      <div>
        <label htmlFor={valueId} className="block text-sm font-medium text-slate-700 mb-1">
          Value (₹) <span aria-hidden="true">*</span>
        </label>
        <input
          id={valueId}
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 500000"
          min="0"
          step="0.01"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          inputMode="decimal"
          required
          aria-required="true"
          aria-invalid={invalidField === "value"}
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
