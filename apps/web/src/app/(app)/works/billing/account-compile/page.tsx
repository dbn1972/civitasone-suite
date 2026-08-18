"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader, Card } from "@/app/_components/ds";
import { useToast } from "@/app/_components/ds/Toast";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  minHeight: 44,
  borderRadius: 8,
  border: "1px solid var(--line)",
  background: "var(--surface, #fff)",
  color: "var(--ink)",
  fontSize: 14,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 4,
  fontWeight: 600,
};

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear - i);

export default function AccountCompilePage() {
  const router = useRouter();
  const { toast } = useToast();

  const [month, setMonth]           = useState(String(new Date().getMonth() + 1));
  const [year, setYear]             = useState(String(currentYear));
  const [submittedTo, setSubmittedTo] = useState("");
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [done, setDone]             = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!submittedTo.trim()) {
      setError("Submitted To is required.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/works/billing/account-compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: parseInt(month, 10),
          year: parseInt(year, 10),
          submittedTo: submittedTo.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (data as { message?: string }).message ??
            `Request failed (${res.status})`,
        );
        return;
      }

      toast.success("Account compile initiated.");
      setDone(true);
      setTimeout(() => router.push("/works/billing"), 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Account Compile"
        subtitle="Compile and submit the monthly account statement to treasury."
        back="/works/billing"
        backLabel="Billing Register"
      />

      <Card style={{ maxWidth: 560, padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
        {done && (
          <div
            role="status"
            style={{
              background: "#ecfdf3",
              color: "#166534",
              padding: "12px 16px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            ✅ Account compile submitted. Redirecting to billing…
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              background: "#fef2f2",
              color: "#b42318",
              padding: "12px 16px",
              borderRadius: 8,
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
        >
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
            This action is restricted to DAO / DO roles. The compile job runs
            asynchronously and generates the monthly expenditure statement.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label style={labelStyle} htmlFor="month">
                Month <span style={{ color: "#b42318" }}>*</span>
              </label>
              <select
                id="month"
                style={{ ...inputStyle, cursor: "pointer" }}
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                required
              >
                {MONTHS.map((name, idx) => (
                  <option key={idx + 1} value={String(idx + 1)}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle} htmlFor="year">
                Year <span style={{ color: "#b42318" }}>*</span>
              </label>
              <select
                id="year"
                style={{ ...inputStyle, cursor: "pointer" }}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                required
              >
                {YEARS.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle} htmlFor="submittedTo">
              Submitted To <span style={{ color: "#b42318" }}>*</span>
            </label>
            <input
              id="submittedTo"
              type="text"
              style={inputStyle}
              value={submittedTo}
              onChange={(e) => setSubmittedTo(e.target.value)}
              placeholder="Office or person receiving the compiled account"
              maxLength={256}
              required
            />
            <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              E.g. "District Treasury Officer, Nashik"
            </p>
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", paddingTop: 4 }}>
            <Link
              href="/works/billing"
              style={{
                padding: "9px 18px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                color: "var(--ink)",
                textDecoration: "none",
                fontSize: 14,
              }}
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={busy || done}
              style={{
                padding: "9px 22px",
                borderRadius: 8,
                background: "var(--accent)",
                color: "#fff",
                border: "none",
                fontWeight: 600,
                fontSize: 14,
                cursor: busy || done ? "not-allowed" : "pointer",
                opacity: busy || done ? 0.7 : 1,
              }}
            >
              {busy ? "Submitting…" : "Compile Account"}
            </button>
          </div>
        </form>
      </Card>
    </main>
  );
}
