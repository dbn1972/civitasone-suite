"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type FormStatus = "idle" | "submitting" | "error";

const SECTORS = [
  { value: "agriculture", label: "Agriculture" },
  { value: "education", label: "Education" },
  { value: "health", label: "Health" },
  { value: "infrastructure", label: "Infrastructure" },
  { value: "social", label: "Social" },
  { value: "other", label: "Other" },
] as const;

type Sector = typeof SECTORS[number]["value"];

export function CreateSchemeForm() {
  const router = useRouter();

  const [schemeName, setSchemeName] = useState("");
  const [schemeCode, setSchemeCode] = useState("");
  const [sector, setSector] = useState<Sector | "">("");
  const [totalBudgetRupees, setTotalBudgetRupees] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side validation
    if (!schemeName.trim()) {
      setStatus("error");
      setMessage("Scheme name is required.");
      return;
    }
    if (!schemeCode.trim()) {
      setStatus("error");
      setMessage("Scheme code is required.");
      return;
    }
    const budgetRupees = parseFloat(totalBudgetRupees);
    if (!totalBudgetRupees || isNaN(budgetRupees) || budgetRupees <= 0) {
      setStatus("error");
      setMessage("Total budget must be a positive number.");
      return;
    }

    setStatus("submitting");
    setMessage("");

    // Convert rupees → paise (minor units × 100)
    const budgetMinor = Math.round(budgetRupees * 100);

    const body = {
      name: schemeName.trim(),
      code: schemeCode.trim().toUpperCase(),
      sector: sector || undefined,
      budgetMinor,
      maxAmountMinor: budgetMinor,
      description: description.trim() || undefined,
    };

    try {
      const res = await fetch("/api/proxy/v1/grants/schemes", {
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
      router.push("/grants/schemes");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="card pad"
      style={{ maxWidth: 820 }}
      noValidate
    >
      <div className="fields">
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="schemeName">
            Scheme Name *
          </label>
          <input
            id="schemeName"
            className="inp"
            value={schemeName}
            onChange={(e) => setSchemeName(e.target.value)}
            required
            style={{ minHeight: 44 }}
            placeholder="e.g. PM Kisan Samman Nidhi"
            aria-required="true"
          />
        </div>

        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="schemeCode">
            Scheme Code *
          </label>
          <input
            id="schemeCode"
            className="inp"
            value={schemeCode}
            onChange={(e) => setSchemeCode(e.target.value)}
            required
            style={{ minHeight: 44 }}
            placeholder="e.g. PM-KISAN-2024"
            aria-required="true"
          />
        </div>

        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="sector">
            Sector
          </label>
          <select
            id="sector"
            className="inp"
            value={sector}
            onChange={(e) => setSector(e.target.value as Sector | "")}
            style={{ minHeight: 44 }}
          >
            <option value="">— Select sector —</option>
            {SECTORS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="totalBudgetMinor">
            Total Budget (₹) *
          </label>
          <input
            id="totalBudgetMinor"
            className="inp"
            type="number"
            min="1"
            step="0.01"
            value={totalBudgetRupees}
            onChange={(e) => setTotalBudgetRupees(e.target.value)}
            required
            style={{ minHeight: 44 }}
            placeholder="e.g. 500000"
            aria-required="true"
            aria-describedby="budget-hint"
          />
          <span id="budget-hint" style={{ fontSize: 12, color: "#64748b", marginTop: 4, display: "block" }}>
            Enter in rupees. Stored internally as paise.
          </span>
        </div>

        <div
          className="field"
          style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}
        >
          <label className="label" htmlFor="description">
            Description
          </label>
          <textarea
            id="description"
            className="inp"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Scheme objectives, eligibility criteria, coverage…"
          />
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p
            role={status === "error" ? "alert" : undefined}
            style={{
              marginTop: 12,
              color: status === "error" ? "#b91c1c" : "#047857",
              fontSize: "0.875rem",
            }}
          >
            {message}
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button
          type="submit"
          className="btn primary"
          style={{ minHeight: 44 }}
          disabled={status === "submitting"}
          aria-busy={status === "submitting"}
        >
          {status === "submitting" ? "Creating…" : "Create Scheme"}
        </button>
        <Link href="/grants/schemes" className="btn ghost" style={{ minHeight: 44 }}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
