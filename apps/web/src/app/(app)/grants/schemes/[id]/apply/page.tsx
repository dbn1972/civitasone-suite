"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, use } from "react";

type FormStatus = "idle" | "submitting" | "success" | "error";

interface ApplyPageProps {
  params: { id: string };
}

export default function ApplyPage({ params }: ApplyPageProps) {
  const schemeId = params.id;
  const router = useRouter();

  const [beneficiaryId, setBeneficiaryId]   = useState("");
  const [purpose, setPurpose]               = useState("");
  const [amountRupees, setAmountRupees]     = useState("");
  const [currency, setCurrency]             = useState("INR");
  const [formStatus, setFormStatus]         = useState<FormStatus>("idle");
  const [message, setMessage]               = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!beneficiaryId.trim()) {
      setFormStatus("error");
      setMessage("Beneficiary ID is required. Enter the registered beneficiary UUID.");
      return;
    }
    if (!purpose.trim() || purpose.trim().length < 10) {
      setFormStatus("error");
      setMessage("Project purpose must be at least 10 characters.");
      return;
    }
    const rupees = parseFloat(amountRupees);
    if (!amountRupees || isNaN(rupees) || rupees <= 0) {
      setFormStatus("error");
      setMessage("Requested amount must be a positive number.");
      return;
    }

    setFormStatus("submitting");
    setMessage("");

    const amountMinor = Math.round(rupees * 100);

    try {
      const res = await fetch(`/api/proxy/v1/grants/schemes/${schemeId}/applications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          beneficiaryId: beneficiaryId.trim(),
          purpose: purpose.trim(),
          amountRequestedMinor: amountMinor,
          currency,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        setFormStatus("error");
        setMessage(text || `Submission failed (HTTP ${res.status})`);
        return;
      }
      setFormStatus("success");
      setMessage("Application submitted successfully. It is now under review.");
      setTimeout(() => router.push("/grants/applications"), 2000);
    } catch (err) {
      setFormStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error — please retry.");
    }
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/grants">Grants</a>{" "}
        <span aria-hidden="true">/</span>{" "}
        <a href="/grants/schemes">Schemes</a>{" "}
        <span aria-hidden="true">/</span>{" "}
        <a href={`/grants/schemes/${schemeId}`}>{schemeId.slice(0, 8)}…</a>{" "}
        <span aria-hidden="true">/</span>{" "}
        <span aria-current="page">Apply</span>
      </nav>

      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--ink)", margin: 0 }}>
          Submit Grant Application
        </h1>
        <p style={{ color: "var(--ink2)", marginTop: 4, fontSize: 14 }}>
          Fill out the form below to apply for this grant scheme.
        </p>
      </header>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="card pad"
        style={{ maxWidth: 820 }}
        noValidate
        aria-label="Grant application form"
      >
        <div className="fields">
          <div className="field" style={{ gridColumn: "1 / -1", background: "var(--panel)", padding: "13px 16px" }}>
            <label className="label" htmlFor="beneficiaryId">
              Beneficiary ID <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
            </label>
            <input
              id="beneficiaryId"
              className="inp"
              value={beneficiaryId}
              onChange={(e) => setBeneficiaryId(e.target.value)}
              required
              aria-required="true"
              style={{ minHeight: 44, fontFamily: "monospace" }}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              aria-describedby="beneficiary-hint"
            />
            <span id="beneficiary-hint" style={{ fontSize: 12, color: "var(--ink2)", marginTop: 4, display: "block" }}>
              UUID of the registered beneficiary from the Grantees registry.{" "}
              <Link href="/grants/grantees" style={{ color: "var(--ink)" }}>Browse grantees →</Link>
            </span>
          </div>

          <div className="field" style={{ gridColumn: "1 / -1", background: "var(--panel)", padding: "13px 16px" }}>
            <label className="label" htmlFor="purpose">
              Project Purpose / Description{" "}
              <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
            </label>
            <textarea
              id="purpose"
              className="inp"
              rows={5}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              required
              aria-required="true"
              placeholder="Describe the project objectives, expected outcomes, and how funds will be utilised. Minimum 10 characters."
              aria-describedby="purpose-hint"
            />
            <span id="purpose-hint" style={{ fontSize: 12, color: "var(--ink2)", marginTop: 4, display: "block" }}>
              {purpose.length} / 2000 characters
            </span>
          </div>

          <div className="field" style={{ background: "var(--panel)", padding: "13px 16px" }}>
            <label className="label" htmlFor="amountRupees">
              Requested Amount (₹){" "}
              <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
            </label>
            <input
              id="amountRupees"
              className="inp"
              type="number"
              min="1"
              step="0.01"
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)}
              required
              aria-required="true"
              style={{ minHeight: 44 }}
              placeholder="e.g. 500000"
              aria-describedby="amount-hint"
            />
            <span id="amount-hint" style={{ fontSize: 12, color: "var(--ink2)", marginTop: 4, display: "block" }}>
              Enter in rupees (₹). Stored as paise internally.
            </span>
          </div>

          <div className="field" style={{ background: "var(--panel)", padding: "13px 16px" }}>
            <label className="label" htmlFor="currency">Currency</label>
            <select
              id="currency"
              className="inp"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              style={{ minHeight: 44 }}
            >
              <option value="INR">INR — Indian Rupee</option>
            </select>
          </div>
        </div>

        <div role="status" aria-live="polite" style={{ marginTop: 12 }}>
          {message && (
            <p
              role={formStatus === "error" ? "alert" : undefined}
              style={{
                color: formStatus === "error" ? "var(--bad)"
                     : formStatus === "success" ? "var(--good)"
                     : "var(--ink)",
                fontSize: "0.875rem",
                margin: 0,
              }}
            >
              {message}
            </p>
          )}
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
          <button
            type="submit"
            className="btn primary"
            style={{ minHeight: 44 }}
            disabled={formStatus === "submitting" || formStatus === "success"}
            aria-busy={formStatus === "submitting"}
          >
            {formStatus === "submitting" ? "Submitting…"
           : formStatus === "success" ? "Submitted ✓"
           : "Submit Application"}
          </button>
          <Link href={`/grants/schemes/${schemeId}`} className="btn" style={{ minHeight: 44 }}>
            Cancel
          </Link>
        </div>

        <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 12 }}>
          Applications are processed asynchronously. You will be able to track
          the status from the{" "}
          <Link href="/grants/applications" style={{ color: "var(--ink)" }}>Applications list</Link>.
        </p>
      </form>
    </>
  );
}
