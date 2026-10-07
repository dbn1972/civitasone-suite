"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader, Button, Field, Input, Select, EntityPicker, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { browserFetch } from "@/lib/api/browserClient";
import { searchWorkOptions, resolveWorkOptions } from "../../_data/worksPicker";

const errBanner = { background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Scope = { id: string; scopeId: string; label: string; target: string; unit: string | null };

function pickScopes(payload: unknown): Array<{ id: string; scopeId: string; description: string; target: string }> {
  const arr = payload && typeof payload === "object" && "data" in payload ? (payload as { data: unknown }).data : payload;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((r) => {
      const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      return {
        id: String(o.id ?? ""),
        scopeId: typeof o.scopeId === "string" ? o.scopeId : "",
        description: typeof o.description === "string" ? o.description.trim() : "",
        target: o.targetValue == null ? "" : String(o.targetValue),
      };
    })
    .filter((s) => s.id);
}

function RecordProgressForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [workId, setWorkId] = useState<string | null>(searchParams.get("workId") || null);

  const [form, setForm] = useState({
    workScopeId: "",
    month: String(currentMonth),
    year: String(currentYear),
    currentAchievement: "",
  });
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [unitByScopeId, setUnitByScopeId] = useState<Map<string, string>>(new Map());
  const [cumulativeByScope, setCumulativeByScope] = useState<Map<string, number>>(new Map());
  const [scopesLoading, setScopesLoading] = useState(false);
  const [scopesError, setScopesError] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const formError = useFormError("progress");

  // GAP-WORKS-EXECUTION-RECORD-PROGRESS-05: masters scopes carry the unit.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await browserFetch("v1/works/masters/scopes?pageSize=100");
        if (!res.ok) return;
        const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
        if (!active) return;
        const m = new Map<string, string>();
        for (const r of json.data ?? []) {
          const id = String(r.id ?? "");
          const unit = typeof r.unit === "string" ? r.unit : "";
          if (id && unit) m.set(id, unit);
        }
        setUnitByScopeId(m);
      } catch {
        /* unit is a display nicety; absence is non-fatal */
      }
    })();
    return () => { active = false; };
  }, []);

  // Load scopes + current cumulative for the chosen work.
  useEffect(() => {
    if (!workId) {
      setScopes([]);
      setScopesError(false);
      return;
    }
    let active = true;
    setScopesLoading(true);
    setScopesError(false);
    void (async () => {
      try {
        const [scopesRes, progRes] = await Promise.all([
          browserFetch(`v1/works/execution/${workId}/scopes`),
          browserFetch(`v1/works/execution/progress?pageSize=100&workId=${encodeURIComponent(workId)}`),
        ]);
        if (!scopesRes.ok) throw new Error("scopes");
        const scopesJson = await scopesRes.json();
        if (!active) return;
        const raw = pickScopes(scopesJson);
        const list: Scope[] = raw.map((s, i) => ({
          id: s.id,
          scopeId: s.scopeId,
          label: s.description || (s.scopeId ? `Scope ${s.scopeId.slice(0, 8)}…` : `Scope ${i + 1}`),
          target: s.target,
          unit: unitByScopeId.get(s.scopeId) ?? null,
        }));
        setScopes(list);
        if (list.length === 1) setForm((f) => ({ ...f, workScopeId: list[0].id }));

        // Current cumulative per work_scope id, if the progress fetch worked.
        const cumMap = new Map<string, number>();
        if (progRes.ok) {
          const progJson = (await progRes.json()) as { data?: Array<Record<string, unknown>> };
          for (const row of progJson.data ?? []) {
            const wsId = String(row.workScopeId ?? "");
            const cur = Number(row.currentAchievement ?? 0);
            if (wsId) cumMap.set(wsId, (cumMap.get(wsId) ?? 0) + (Number.isFinite(cur) ? cur : 0));
          }
        }
        if (active) setCumulativeByScope(cumMap);
      } catch {
        if (active) { setScopes([]); setScopesError(true); }
      } finally {
        if (active) setScopesLoading(false);
      }
    })();
    return () => { active = false; };
  }, [workId, unitByScopeId]);

  const selectedScope = useMemo(() => scopes.find((s) => s.id === form.workScopeId) ?? null, [scopes, form.workScopeId]);
  const currentCumulative = form.workScopeId ? cumulativeByScope.get(form.workScopeId) ?? 0 : 0;
  const addend = Number(form.currentAchievement);
  const newTotal = Number.isFinite(addend) ? currentCumulative + addend : currentCumulative;
  const targetNum = selectedScope?.target ? Number(selectedScope.target) : null;
  const overTarget = targetNum != null && Number.isFinite(newTotal) && newTotal > targetNum;
  const unit = selectedScope?.unit ?? "";

  const selectedPeriod = Number(form.year) * 100 + Number(form.month);
  const currentPeriod = currentYear * 100 + currentMonth;
  const futurePeriod = selectedPeriod > currentPeriod;
  const backDated = selectedPeriod < currentPeriod - 1; // more than one month old

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  function validateBeforeConfirm(): string | null {
    if (!form.workScopeId) return "Select a scope.";
    if (!form.currentAchievement || !Number.isFinite(addend)) return "Enter the quantity done this period.";
    if (futurePeriod) return "A future reporting period cannot be recorded.";
    return null;
  }

  function onReview(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const msg = validateBeforeConfirm();
    if (msg) { setError(msg); return; }
    setConfirmOpen(true);
  }

  async function doSubmit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setError("");
    formError.clear();
    try {
      const body = {
        workScopeId: form.workScopeId.trim(),
        month: Number(form.month),
        year: Number(form.year),
        currentAchievement: addend,
      };
      const res = await fetch("/api/proxy/v1/works/execution/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        inFlight.current = false;
        setBusy(false);
        return;
      }
      // GAP-WORKS-EXECUTION-RECORD-PROGRESS-03: stay disabled through the
      // redirect (don't clear busy on success) so a double click can't re-POST.
      setSaved(true);
      setConfirmOpen(false);
      setMessage("Progress recorded.");
      toast.success("Progress recorded.");
      setTimeout(() => router.push(workId ? `/works/execution/${workId}` : "/works/execution"), 600);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
      inFlight.current = false;
      setBusy(false);
    }
  }

  const backHref = workId ? `/works/execution/${workId}` : "/works/execution";
  const years = Array.from({ length: 3 }, (_, i) => currentYear - 2 + i);

  return (
    <>
      <PageHeader
        title="Record Progress"
        subtitle="Log the quantity of work done in a scope this period. It is added to the running total."
        back={backHref}
        backLabel="Execution"
      />
      {message ? <div role="status" aria-live="polite" style={okBanner}>{message}</div> : null}
      {error ? <div role="alert" aria-live="assertive" style={errBanner}>{error}</div> : null}
      <div className="card">
        <form onSubmit={onReview} className="pad" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }} noValidate>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Fields marked * are required.</p>

          {/* GAP-WORKS-EXECUTION-RECORD-PROGRESS-01: pick the work by name when
              not arriving from a work page — no scope-UUID typing anywhere. */}
          <Field label="Work" required>
            <EntityPicker
              value={workId}
              onChange={(v) => {
                setWorkId(Array.isArray(v) ? (v[0] ?? null) : v);
                setForm((f) => ({ ...f, workScopeId: "" }));
              }}
              search={searchWorkOptions}
              resolve={resolveWorkOptions}
              initialOptions={workId ? [{ id: workId, label: workId }] : undefined}
              placeholder="Search by work number or description…"
            />
          </Field>

          <Field label="Work Scope" required>
            <Select value={form.workScopeId} onChange={set("workScopeId")} required disabled={!workId || scopesLoading}>
              <option value="">{workId ? "Select a scope…" : "Choose a work first"}</option>
              {scopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {s.target ? ` — target ${s.target}${s.unit ? ` ${s.unit}` : ""}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          {scopesLoading ? (
            <p style={{ fontSize: 11, color: "var(--muted)", marginTop: -8 }}>Loading scopes…</p>
          ) : scopesError ? (
            <p role="alert" style={{ fontSize: 12, color: "#b42318", marginTop: -8 }}>
              Couldn&apos;t load this work&apos;s scopes.{" "}
              <button type="button" className="btn ghost sm" onClick={() => setWorkId((w) => (w ? `${w}` : w))}>
                Retry
              </button>
            </p>
          ) : workId && scopes.length === 0 ? ( // ux-001-ok: the preceding scopesError arm already handles a failed scopes fetch, so this arm is only reached for a successful empty response
            <p style={{ fontSize: 11, color: "var(--muted)", marginTop: -8 }}>No scopes defined for this work.</p>
          ) : null}

          {/* GAP-WORKS-EXECUTION-RECORD-PROGRESS-02: show current cumulative. */}
          {selectedScope && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Recorded so far: <strong>{currentCumulative}</strong>
              {targetNum != null ? ` of target ${targetNum}` : ""}
              {unit ? ` ${unit}` : ""}
              {Number.isFinite(addend) && form.currentAchievement ? (
                <> — new total <strong style={{ color: overTarget ? "#b42318" : "inherit" }}>{newTotal}</strong></>
              ) : null}
            </div>
          )}

          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <Field label="Month" required>
              <Select value={form.month} onChange={set("month")} required>
                {MONTHS.map((name, idx) => (
                  <option key={idx + 1} value={String(idx + 1)}>{name}</option>
                ))}
              </Select>
            </Field>

            <Field label="Year" required>
              <Select value={form.year} onChange={set("year")} required>
                {years.map((y) => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </Select>
            </Field>

            <Field label={`Quantity done this period${unit ? ` (${unit})` : ""}`} required>
              <Input
                type="number"
                value={form.currentAchievement}
                onChange={set("currentAchievement")}
                step="0.01"
                min={0}
                max={targetNum != null ? Math.max(0, targetNum - currentCumulative) : undefined}
                placeholder="e.g. 20"
                required
              />
            </Field>
          </div>

          {futurePeriod && (
            <p role="alert" style={{ fontSize: 12, color: "#b42318" }}>A future reporting period cannot be recorded.</p>
          )}
          {!futurePeriod && backDated && (
            <p style={{ fontSize: 12, color: "#92400e" }}>Back-dated entry — recording for an earlier period.</p>
          )}
          {overTarget && (
            <p style={{ fontSize: 12, color: "#b42318" }}>
              New total {newTotal} exceeds the scope target {targetNum}.
            </p>
          )}

          <div style={{
            background: "var(--surface-raised, #f8fafc)", border: "1px solid var(--line)", borderRadius: 10,
            padding: "10px 14px", fontSize: 12, color: "var(--muted)", lineHeight: 1.5,
          }}>
            Enter the <strong>quantity of work done in this period only</strong> — it is added to the running
            cumulative total, not replacing it.
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
            <Button variant="ghost" type="button" onClick={() => router.push(backHref)} disabled={busy || saved}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy || saved || futurePeriod}>
              {busy || saved ? "Saving…" : "Record Progress"}
            </Button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Record progress"
        description={
          selectedScope
            ? `Add ${form.currentAchievement}${unit ? ` ${unit}` : ""} to "${selectedScope.label}"? Total becomes ${newTotal}${targetNum != null ? ` of ${targetNum}` : ""}.${overTarget ? " This exceeds the target." : ""}${backDated ? " This is a back-dated entry." : ""}`
            : ""
        }
        confirmLabel="Record"
        danger={overTarget}
        busy={busy || saved}
        errorMessage={error || undefined}
        onConfirm={doSubmit}
        onCancel={() => setConfirmOpen(false)}
      />
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
