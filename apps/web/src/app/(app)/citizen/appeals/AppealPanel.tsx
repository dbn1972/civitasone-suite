"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EntityPicker, type EntityOption } from "@/app/_components/ds";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { formatIndianDate } from "@/lib/formatters";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

interface Filed { id: string; status: string; filingDeadline: string }

/** Defensive narrowing — the proxy returns the citizen's own request summaries. */
function toOption(r: unknown): EntityOption | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : null;
  if (!id) return null;
  const name = typeof o.serviceName === "string" ? o.serviceName
    : typeof o.subject === "string" ? o.subject
    : typeof o.title === "string" ? o.title
    : id;
  const submitted = typeof o.submittedDate === "string" ? o.submittedDate
    : typeof o.createdAt === "string" ? o.createdAt
    : null;
  return { id, label: name, sublabel: submitted ? formatIndianDate(submitted) : undefined };
}

/**
 * SVC-089 — file an appeal against a decision within the (server-derived)
 * statutory window.
 *
 * GAP-CITIZEN-APPEALS-02: the raw "Application ID (UUID, optional)" free-text
 * input is replaced by a required EntityPicker over the citizen's own
 * applications, so an appeal can no longer be filed against nothing or a
 * mistyped UUID. The editable "filing window (days)" field is removed — the
 * window is statutory and derived server-side (GAP-CITIZEN-APPEALS-01).
 * GAP-CITIZEN-APPEALS-04: a failed POST now shows friendly, mapped copy — the
 * raw response body is never rendered.
 */
export function AppealPanel() {
  const t = useTranslations("citizenAppeals");
  const searchParams = useSearchParams();
  const [applicationId, setApplicationId] = useState<string | null>(searchParams.get("applicationId"));
  const [grounds, setGrounds] = useState("");
  const [decisionDate, setDecisionDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filed, setFiled] = useState<Filed | null>(null);

  const search = useCallback(async (query: string, signal: AbortSignal): Promise<EntityOption[]> => {
    const res = await fetch("/api/proxy/v1/citizen/requests", { signal });
    if (!res.ok) return [];
    const body = (await res.json()) as unknown;
    const rows = Array.isArray(body) ? body : Array.isArray((body as { data?: unknown })?.data) ? (body as { data: unknown[] }).data : [];
    const q = query.trim().toLowerCase();
    return rows
      .map(toOption)
      .filter((o): o is EntityOption => o !== null)
      .filter((o) => q === "" || o.label.toLowerCase().includes(q));
  }, []);

  async function file(e: React.FormEvent) {
    e.preventDefault();
    if (!applicationId) return;
    setBusy(true); setError(""); setFiled(null);
    try {
      const res = await fetch("/api/proxy/v1/citizen/appeals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ applicationId, grounds, decisionDate }),
      });
      if (!res.ok) {
        // GAP-CITIZEN-APPEALS-04: map known codes to friendly copy; the raw
        // body is never shown. FILING_WINDOW_EXPIRED keeps its specific line.
        const { code } = await res.clone().json().then(
          (b: { code?: unknown }) => ({ code: typeof b?.code === "string" ? b.code : null }),
          () => ({ code: null }),
        );
        if (code === "FILING_WINDOW_EXPIRED") throw new Error(t("errorWindowExpired"));
        throw await userFacingErrorFromResponse(res, "save", "appeal");
      }
      setFiled((await res.json()) as Filed);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <form onSubmit={file} className="pad" style={{ maxWidth: 640 }}>
        <h4 style={{ marginTop: 0 }}>{t("formTitle")}</h4>
        <label htmlFor="ap-app" style={labelStyle}>{t("applicationId")}</label>
        <EntityPicker
          id="ap-app"
          value={applicationId}
          onChange={(v) => setApplicationId(Array.isArray(v) ? (v[0] ?? null) : v)}
          search={search}
          placeholder={t("applicationPlaceholder")}
          aria-label={t("applicationId")}
        />
        <div style={{ height: 8 }} />
        <label htmlFor="ap-date" style={labelStyle}>{t("decisionDate")}</label>
        <input id="ap-date" type="date" value={decisionDate} onChange={(e) => setDecisionDate(e.target.value)} style={inputStyle} />
        <label htmlFor="ap-grounds" style={labelStyle}>{t("grounds")}</label>
        <textarea id="ap-grounds" value={grounds} onChange={(e) => setGrounds(e.target.value)} style={{ ...inputStyle, minHeight: 96 }} />
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={busy || !applicationId || !grounds || !decisionDate}>
          {busy ? t("filing") : t("submit")}
        </Button>
        {filed ? (
          <div role="status" className="pad" style={{ marginTop: 12, background: "#ecfdf3", borderRadius: 8 }}>
            {t("filedStatus", { status: filed.status })} {t("filedDeadline", { date: formatIndianDate(filed.filingDeadline) })}
          </div>
        ) : null}
        {error ? <p role="alert" style={{ color: "#b42318", fontSize: 13 }}>{error}</p> : null}
      </form>
    </div>
  );
}
