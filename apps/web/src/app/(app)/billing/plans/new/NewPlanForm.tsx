"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

const INTERVALS = ["monthly", "quarterly", "yearly"] as const;
const CURRENCIES = ["INR", "USD", "EUR", "GBP"] as const;
const CODE_RE = /^[a-z0-9_-]+$/i;

export function NewPlanForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>("monthly");
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("INR");
  const [govtExempt, setGovtExempt] = useState(true);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [invalidField, setInvalidField] = useState<string | null>(null);

  const nameId = useId();
  const codeId = useId();
  const amountId = useId();
  const intervalId = useId();
  const currencyId = useId();
  const govtExemptId = useId();
  const statusMsgId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (name.trim().length < 2) {
      setStatus("error");
      setInvalidField("name");
      setMessage("Plan name must be at least 2 characters.");
      return;
    }
    const trimmedCode = code.trim();
    if (trimmedCode.length < 2 || trimmedCode.length > 64) {
      setStatus("error");
      setInvalidField("code");
      setMessage("Plan code must be between 2 and 64 characters.");
      return;
    }
    if (!CODE_RE.test(trimmedCode)) {
      setStatus("error");
      setInvalidField("code");
      setMessage("Plan code may only contain letters, digits, hyphens, and underscores.");
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      setStatus("error");
      setInvalidField("amount");
      setMessage("Amount must be a positive number.");
      return;
    }

    setStatus("submitting");
    setInvalidField(null);
    setMessage("");

    try {
      const res = await fetch("/api/proxy/v1/billing/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: trimmedCode,
          priceMinor: Math.round(parsedAmount * 100),
          currency,
          govtExempt,
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }

      setStatus("success");
      setMessage("Plan created successfully.");
      router.push("/billing/plans");
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
        <label htmlFor={nameId} style={{ display:"block", fontSize:13, fontWeight:600, color:"var(--ink2)", marginBottom:4 }}>
          Plan Name
        </label>
        <input
          id={nameId}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Standard Monthly"
          style={{ width:"100%", borderRadius:10, border:"1px solid var(--line)", padding:"10px 12px", fontSize:13, minHeight:44, background:"var(--panel)", color:"var(--ink)", outline:"none" }}
          required
          aria-required="true"
          aria-invalid={invalidField === "name"}
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor={codeId} style={{ display:"block", fontSize:13, fontWeight:600, color:"var(--ink2)", marginBottom:4 }}>
          Plan Code
        </label>
        <input
          id={codeId}
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. standard_monthly"
          style={{ width:"100%", borderRadius:10, border:"1px solid var(--line)", padding:"10px 12px", fontSize:13, minHeight:44, background:"var(--panel)", color:"var(--ink)", outline:"none" }}
          required
          aria-required="true"
          aria-invalid={invalidField === "code"}
          minLength={2}
          maxLength={64}
          pattern="[A-Za-z0-9_\-]+"
          autoComplete="off"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={amountId} style={{ display:"block", fontSize:13, fontWeight:600, color:"var(--ink2)", marginBottom:4 }}>
            Amount
          </label>
          <input
            id={amountId}
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            style={{ width:"100%", borderRadius:10, border:"1px solid var(--line)", padding:"10px 12px", fontSize:13, minHeight:44, background:"var(--panel)", color:"var(--ink)", outline:"none" }}
            required
            aria-required="true"
            aria-invalid={invalidField === "amount"}
          />
        </div>

        <div>
          <label htmlFor={currencyId} style={{ display:"block", fontSize:13, fontWeight:600, color:"var(--ink2)", marginBottom:4 }}>
            Currency
          </label>
          <select
            id={currencyId}
            value={currency}
            onChange={(e) => setCurrency(e.target.value as (typeof CURRENCIES)[number])}
            style={{ width:"100%", borderRadius:10, border:"1px solid var(--line)", padding:"10px 12px", fontSize:13, minHeight:44, background:"var(--panel)", color:"var(--ink)", outline:"none" }}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={intervalId} style={{ display:"block", fontSize:13, fontWeight:600, color:"var(--ink2)", marginBottom:4 }}>
            Billing Interval
          </label>
          <select
            id={intervalId}
            value={interval}
            onChange={(e) => setInterval(e.target.value as (typeof INTERVALS)[number])}
            style={{ width:"100%", borderRadius:10, border:"1px solid var(--line)", padding:"10px 12px", fontSize:13, minHeight:44, background:"var(--panel)", color:"var(--ink)", outline:"none" }}
          >
            {INTERVALS.map((i) => (
              <option key={i} value={i}>
                {i.charAt(0).toUpperCase() + i.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          id={govtExemptId}
          type="checkbox"
          checked={govtExempt}
          onChange={(e) => setGovtExempt(e.target.checked)}
          className="h-4 w-4 rounded"
        />
        <label htmlFor={govtExemptId} style={{ fontSize:13, fontWeight:600, color:"var(--ink2)" }}>
          Government exempt
        </label>
      </div>

      <button
        type="submit"
        disabled={status === "submitting"}
        className="btn primary"
        style={{ minHeight: 44 }}
      >
        {status === "submitting" ? "Creating…" : "Create Plan"}
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
