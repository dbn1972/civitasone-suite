"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Select, Textarea } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { formatIndianDate, formatShortId } from "@/lib/formatters";
import { REPORT_GRADES, REPORT_TYPES, REPORT_TYPE_KEYS } from "../reportMeta";

type InspectionOption = { id: string; entityId: string; label: string };

/**
 * UAT Phase 2 C3 (J13): raise an inspection report. POST /v1/inspection/reports
 * needs the inspection and the inspected entity; the entity is taken from the
 * chosen inspection (never typed), so a report cannot name the wrong entity.
 */
export function CreateReportForm({ initialInspectionId }: { initialInspectionId?: string }) {
  const t = useTranslations("inspectionReports");
  const router = useRouter();
  const formError = useFormError("inspection report");
  const [options, setOptions] = useState<InspectionOption[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [nonce, setNonce] = useState(0);
  const [inspectionId, setInspectionId] = useState(initialInspectionId ?? "");
  const [reportType, setReportType] = useState<string>("standard");
  const [grade, setGrade] = useState("");
  const [summary, setSummary] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoadState("loading");
    fetch("/api/proxy/v1/inspection/inspections?pageSize=100", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("inspections lookup failed");
        const body = (await res.json()) as unknown;
        const rows = (Array.isArray(body) ? body : ((body as { data?: unknown[] })?.data ?? [])) as Array<Record<string, unknown>>;
        setOptions(rows
          .filter((r) => typeof r.id === "string" && typeof r.entityId === "string")
          .map((r) => {
            const when = typeof r.scheduledDate === "string" ? r.scheduledDate : typeof r.createdAt === "string" ? r.createdAt : null;
            const parts = [formatShortId(String(r.id)), typeof r.state === "string" ? r.state.replace(/_/g, " ") : null, when ? formatIndianDate(when) : null];
            return { id: String(r.id), entityId: String(r.entityId), label: parts.filter(Boolean).join(" · ") };
          }));
        setLoadState("ready");
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setOptions([]);
        setLoadState("error");
      });
    return () => controller.abort();
  }, [nonce]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const chosen = options.find((o) => o.id === inspectionId);
    if (!chosen) {
      setError(t("chooseInspection"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/proxy/v1/inspection/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inspectionId: chosen.id,
          entityId: chosen.entityId,
          reportType,
          ...(grade ? { overallGrade: grade } : {}),
          ...(summary.trim() ? { summary: summary.trim() } : {}),
          ...(recommendations.trim() ? { recommendations: recommendations.trim() } : {}),
        }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { data?: { id?: string }; id?: string };
      const id = body.data?.id ?? body.id;
      // 202 = received: the report is written asynchronously, so return to the
      // register with an honest "will appear shortly" notice.
      router.push(`/inspection/reports?created=${encodeURIComponent(id ?? "1")}`);
      router.refresh();
    } catch (err) {
      setError(formError.fromException("save", err).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card pad" onSubmit={(e) => void onSubmit(e)} noValidate style={{ maxWidth: 720 }}>
      <div className="fields">
        <Field id="rep-inspection" label={t("inspectionLabel")} required>
          <Select value={inspectionId} onChange={(e) => setInspectionId(e.target.value)} disabled={loadState === "loading"}>
            <option value="">{loadState === "loading" ? t("inspectionsLoading") : t("inspectionPlaceholder")}</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select>
          {loadState === "error" ? (
            <span role="alert" style={{ fontSize: "0.8125rem", color: "var(--bad)" }}>
              {t("inspectionsFailed")}{" "}
              <button type="button" className="btn ghost" style={{ padding: "2px 8px" }} onClick={() => setNonce((n) => n + 1)}>{t("retry")}</button>
            </span>
          ) : loadState === "ready" && options.length === 0 ? (
            <span role="status" style={{ fontSize: "0.8125rem" }}>{t("inspectionsEmpty")}</span>
          ) : null}
        </Field>
        <Field id="rep-type" label={t("reportTypeLabel")}>
          <Select value={reportType} onChange={(e) => setReportType(e.target.value)}>
            {REPORT_TYPES.map((rt) => <option key={rt} value={rt}>{t(REPORT_TYPE_KEYS[rt]!)}</option>)}
          </Select>
        </Field>
        <Field id="rep-grade" label={t("gradeLabel")}>
          <Select value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">{t("gradeNone")}</option>
            {REPORT_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
        </Field>
        <Field id="rep-summary" label={t("summaryLabel")} style={{ gridColumn: "1 / -1" }}>
          <Textarea rows={4} maxLength={4000} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        <Field id="rep-recs" label={t("recommendationsLabel")} style={{ gridColumn: "1 / -1" }}>
          <Textarea rows={4} maxLength={4000} value={recommendations} onChange={(e) => setRecommendations(e.target.value)} />
        </Field>
      </div>
      <div role="status" aria-live="polite">
        {error ? <p role="alert" style={{ marginTop: 12, fontSize: "0.875rem", color: "var(--bad)" }}>{error}</p> : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={submitting || loadState !== "ready"}>
          {submitting ? t("creating") : t("createSubmit")}
        </Button>
        <Link href="/inspection/reports" className="btn ghost" style={{ minHeight: 44 }}>{t("cancel")}</Link>
      </div>
    </form>
  );
}
