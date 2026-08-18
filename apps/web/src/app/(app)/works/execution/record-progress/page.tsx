"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader } from "@/app/_components/ds";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errBanner = { background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function RecordProgressPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState({
    workScopeId: "",
    month: "1",
    year: String(new Date().getFullYear()),
    currentAchievement: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const body = {
        workScopeId: form.workScopeId.trim(),
        month: Number(form.month),
        year: Number(form.year),
        currentAchievement: Number(form.currentAchievement),
      };

      const res = await fetch("/api/proxy/v1/works/execution/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!res.ok) throw new Error(data?.message ?? "Create failed");
      setMessage("Progress recorded.");
      toast.success("Progress recorded.");
      setTimeout(() => router.push("/works/execution"), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Record Progress"
        subtitle="Record cumulative achievement for a work scope in a given month."
        back="/works/execution"
        backLabel="Execution"
      />
      {message ? (
        <div role="status" aria-live="polite" style={okBanner}>
          {message}
        </div>
      ) : null}
      {error ? (
        <div role="alert" aria-live="assertive" style={errBanner}>
          {error}
        </div>
      ) : null}
      <div className="card">
        <form
          onSubmit={submit}
          className="pad"
          style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}
        >
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Fields marked * are required.</p>

          <div>
            <label style={labelStyle} htmlFor="workScopeId">Work Scope ID (UUID) *</label>
            <input
              id="workScopeId"
              style={inputStyle}
              type="text"
              value={form.workScopeId}
              onChange={set("workScopeId")}
              placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
              required
            />
          </div>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            }}
          >
            <div>
              <label style={labelStyle} htmlFor="month">Month *</label>
              <select
                id="month"
                style={inputStyle}
                value={form.month}
                onChange={set("month")}
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
              <label style={labelStyle} htmlFor="year">Year *</label>
              <input
                id="year"
                style={inputStyle}
                type="number"
                value={form.year}
                onChange={set("year")}
                min={2000}
                step={1}
                required
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="currentAchievement">Current achievement *</label>
              <input
                id="currentAchievement"
                style={inputStyle}
                type="number"
                value={form.currentAchievement}
                onChange={set("currentAchievement")}
                step="0.01"
                min={0}
                placeholder="Cumulative value (e.g. 75.5 for 75.5%)"
                required
              />
            </div>
          </div>

          <div
            style={{
              background: "var(--surface-raised, #f8fafc)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 12,
              color: "var(--muted)",
              lineHeight: 1.5,
            }}
          >
            Enter the <strong>cumulative</strong> achievement to date, not the period increment.
            For example, if last month was 40% and this month added 20%, enter 60.
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
            <button
              type="button"
              onClick={() => router.push("/works/execution")}
              style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", cursor: "pointer" }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1 }}
              disabled={busy}
            >
              {busy ? "Saving…" : "Record Progress"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
