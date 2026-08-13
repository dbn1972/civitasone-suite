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
      style={{ display:"flex", flexDirection:"column", gap:16, padding:24, maxWidth:672, background:"var(--panel)", border:"1px solid var(--line)", borderRadius:"var(--r)", boxShadow:"var(--sh-md)" }}
      aria-describedby={message ? statusMsgId : undefined}
      noValidate
    >
      <div>
        <label htmlFor={contractNoId} style={{ display:"block", fontSize:13, fontWeight:600, color:"var(--ink2)", marginBottom:4 }}>
          Contract No <span aria-hidden="true">*</span>
        </label>
        <input
          id={contractNoId}
          type="text"
          value={contractNo}
          onChange={(e) => setContractNo(e.target.value)}
          placeholder="e.g. CON-2024-0007"
          style={{ width:"100%", borderRadius:10, border:"1px solid var(--line)", padding:"10px 12px", fontSize:13, minHeight:44, background:"var(--panel)", color:"var(--ink)", outline:"none" }}
          required
          aria-required="true"
          aria-invalid={invalidField === "contractNo"}
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor={titleId} style={{ display:"block", fontSize:13, fontWeight:600, color:"var(--ink2)", marginBottom:4 }}>
          Title <span aria-hidden="true">*</span>
        </label>
        <input
          id={titleId}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Annual IT Maintenance"
          style={{ width:"100%", borderRadius:10, border:"1px solid var(--line)", padding:"10px 12px", fontSize:13, minHeight:44, background:"var(--panel)", color:"var(--ink)", outline:"none" }}
          required
          aria-required="true"
          aria-invalid={invalidField === "title"}
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor={vendorId_} style={{ display:"block", fontSize:13, fontWeight:600, color:"var(--ink2)", marginBottom:4 }}>
          Vendor ID (UUID) <span aria-hidden="true">*</span>
        </label>
        <input
          id={vendorId_}
          type="text"
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          placeholder="e.g. 3f2504e0-4f89-41d3-9a0c-0305e82c3301"
          style={{ width:"100%", borderRadius:10, border:"1px solid var(--line)", padding:"10px 12px", fontSize:13, minHeight:44, background:"var(--panel)", color:"var(--ink)", outline:"none" }}
          required
          aria-required="true"
          aria-invalid={invalidField === "vendorId"}
          autoComplete="off"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label htmlFor={startId} style={{ display:"block", fontSize:13, fontWeight:600, color:"var(--ink2)", marginBottom:4 }}>
            Start Date <span aria-hidden="true">*</span>
          </label>
          <input
            id={startId}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ width:"100%", borderRadius:10, border:"1px solid var(--line)", padding:"10px 12px", fontSize:13, minHeight:44, background:"var(--panel)", color:"var(--ink)", outline:"none" }}
            required
            aria-required="true"
            aria-invalid={invalidField === "startDate"}
          />
        </div>
        <div>
          <label htmlFor={expiryId} style={{ display:"block", fontSize:13, fontWeight:600, color:"var(--ink2)", marginBottom:4 }}>
            Expiry Date <span aria-hidden="true">*</span>
          </label>
          <input
            id={expiryId}
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            style={{ width:"100%", borderRadius:10, border:"1px solid var(--line)", padding:"10px 12px", fontSize:13, minHeight:44, background:"var(--panel)", color:"var(--ink)", outline:"none" }}
            required
            aria-required="true"
            aria-invalid={invalidField === "expiry"}
          />
        </div>
      </div>

      <div>
        <label htmlFor={valueId} style={{ display:"block", fontSize:13, fontWeight:600, color:"var(--ink2)", marginBottom:4 }}>
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
          style={{ width:"100%", borderRadius:10, border:"1px solid var(--line)", padding:"10px 12px", fontSize:13, minHeight:44, background:"var(--panel)", color:"var(--ink)", outline:"none" }}
          inputMode="decimal"
          required
          aria-required="true"
          aria-invalid={invalidField === "value"}
        />
      </div>

      <button
        type="submit"
        disabled={status === "submitting"}
        className="btn primary"
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
