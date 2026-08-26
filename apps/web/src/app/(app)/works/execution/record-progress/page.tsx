"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
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

// Shape returned by GET /v1/works/execution/:workId/scopes — a raw select from
// work_scopes (see works-service execution/repo.ts listScopes / schema.ts):
//   { id, tenantId, workId, scopeId, targetValue, description, plannedStart,
//     plannedEnd, version }
// There is no scopeName / unit column and no scope-catalog join, so the display
// label comes from `description` (optional per addScopeSchema) with a
// distinguishable fallback derived from scopeId, and the target from `targetValue`.
type Scope = { id: string; label: string; target: string };

function pickScopes(payload: unknown): Scope[] {
  const arr =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as { data: unknown }).data
      : payload;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((r, i) => {
      const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      const id = String(o.id ?? "");
      const scopeId = typeof o.scopeId === "string" ? o.scopeId : "";
      const description = typeof o.description === "string" ? o.description.trim() : "";
      const target = o.targetValue == null ? "" : String(o.targetValue);
      // description is optional — fall back to a scope-specific label so two
      // scopes are never rendered as the same string.
      const label = description || (scopeId ? `Scope ${scopeId.slice(0, 8)}…` : `Scope ${i + 1}`);
      return { id, label, target };
    })
    .filter((s) => s.id);
}

function RecordProgressForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const workId = searchParams.get("workId") ?? "";

  const [form, setForm] = useState({
    workScopeId: "",
    month: String(new Date().getMonth() + 1),
    year: String(new Date().getFullYear()),
    currentAchievement: "",
  });
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [scopesLoading, setScopesLoading] = useState(Boolean(workId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // When arriving from a work's execution page, load that work's scopes so the
  // clerk can pick one by name instead of hand-pasting a scope UUID.
  useEffect(() => {
    if (!workId) return;
    let active = true;
    setScopesLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/works/execution/${workId}/scopes`, {
          headers: { "content-type": "application/json" },
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (!active) return;
        const list = pickScopes(json);
        setScopes(list);
        // Auto-select the only scope, so a single-scope work needs no choice.
        if (list.length === 1) setForm((f) => ({ ...f, workScopeId: list[0].id }));
      } catch {
        // Fall back to manual UUID entry below.
        if (active) setScopes([]);
      } finally {
        if (active) setScopesLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [workId]);

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  const useScopeDropdown = scopes.length > 0;

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
      setTimeout(() => router.push(workId ? `/works/execution/${workId}` : "/works/execution"), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const backHref = workId ? `/works/execution/${workId}` : "/works/execution";

  return (
    <>
      <PageHeader
        title="Record Progress"
        subtitle="Log the work done in a scope this month. Progress is added to the running total."
        back={backHref}
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
            <label style={labelStyle} htmlFor="workScopeId">Work Scope *</label>
            {useScopeDropdown ? (
              <select
                id="workScopeId"
                style={inputStyle}
                value={form.workScopeId}
                onChange={set("workScopeId")}
                required
              >
                <option value="">Select a scope…</option>
                {scopes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                    {s.target ? ` — target ${s.target}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="workScopeId"
                style={inputStyle}
                type="text"
                value={form.workScopeId}
                onChange={set("workScopeId")}
                placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                required
              />
            )}
            {scopesLoading ? (
              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Loading scopes…</p>
            ) : !useScopeDropdown && workId ? (
              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                No scopes found for this work — enter a scope ID manually.
              </p>
            ) : null}
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
              <label style={labelStyle} htmlFor="currentAchievement">Progress this period *</label>
              <input
                id="currentAchievement"
                style={inputStyle}
                type="number"
                value={form.currentAchievement}
                onChange={set("currentAchievement")}
                step="0.01"
                min={0}
                placeholder="Amount done this month (e.g. 20)"
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
            Enter the <strong>work done in this period only</strong> — it is added to the running
            cumulative total, not replacing it. For example, if the scope was at 40% and you completed
            another 20% this month, enter <strong>20</strong> (the system will make the total 60%).
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
            <button
              type="button"
              onClick={() => router.push(backHref)}
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

export default function RecordProgressPage() {
  return (
    <Suspense>
      <RecordProgressForm />
    </Suspense>
  );
}
