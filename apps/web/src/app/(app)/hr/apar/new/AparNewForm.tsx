"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { z } from "zod";
import Link from "next/link";
import { PageHeader, Card, Button, Field, Select, EntityPicker } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";

// GAP-HR-APAR-NEW-01: moved out of page.tsx (which is now a server
// component doing the role gate below) -- this is the client form body.
//
// GAP-HR-APAR-NEW-02/NEW-05: the four employee pickers now use the shared
// EntityPicker (GAP-HR-SF-06) over the existing searchEmployees/
// resolveEmployees adapters -- the same debounced, cancellable, tenant-
// scoped `?q=` search every other HR form already uses. This removes both
// NEW-02's raw-UUID fallback (no fallback path exists any more: the
// picker's own empty/no-results state replaces it) and NEW-05's
// limit=200-with-no-search cap.
//
// GAP-HR-APAR-NEW-03: client-side zod schema mirrors the backend's own
// SELF_OFFICER_FORBIDDEN / OFFICERS_NOT_DISTINCT checks (apar/routes.ts)
// so a duplicate selection is caught with an inline, per-field message
// before any network call, not just after a 400. The four pickers also
// exclude each other's current selections from their own search results,
// so most duplicates are never selectable in the first place -- the
// schema is the authoritative backstop (e.g. two tabs, or a picker whose
// options were fetched before another field changed).
//
// GAP-HR-APAR-NEW-04: appraisal period is now a closed set of Indian
// financial-year options ("2025-26" style), not free text -- the
// "2025-2026"/"FY26" variants this gap named can no longer be typed at
// all. The backend's own format + uniqueness (409 DUPLICATE_APAR) checks
// are the authority; this just can't produce a malformed value client-side.
//
// GAP-HR-APAR-NEW-06: Cancel is a real link (keyboard-focusable navigation
// with link semantics -- middle-click/open-in-new-tab, screen readers
// announce "link"), not a Button doing router.push.
// `required_error`/`invalid_type_error` cover the (UI-disabled, but not
// type-system-prevented) case of submitting with a picker still null --
// every realistic failure on these fields maps to the same plain
// "Required." copy rather than ever surfacing a raw Zod type-check
// message, since EntityPicker only ever supplies a real uuid once
// something is actually selected.
const requiredUuid = () =>
  z.string({ required_error: "REQUIRED", invalid_type_error: "REQUIRED" }).uuid({ message: "REQUIRED" });

// Exported for a direct schema-level unit test (GAP-HR-APAR-NEW-03's own
// acceptance criterion: "Unit test schema: same person as RO and RvO fails
// with a message on reviewingOfficerId; appraisee as AA fails") -- the
// EntityPicker-level exclusion below (fix step 2) makes this combination
// unreachable through ordinary sequential UI interaction (once a person is
// chosen in any one slot, every other picker's own search excludes them
// too), so the schema itself, not a DOM-driven test, is the right level
// to prove this rule.
export const aparNewSchema = z
  .object({
    employeeId: requiredUuid(),
    appraisalPeriod: z.string({ required_error: "REQUIRED", invalid_type_error: "REQUIRED" }).regex(/^\d{4}-\d{2}$/, "REQUIRED"),
    reportingOfficerId: requiredUuid(),
    reviewingOfficerId: requiredUuid(),
    acceptingAuthorityId: requiredUuid(),
  })
  .superRefine((v, ctx) => {
    const officerFields = ["reportingOfficerId", "reviewingOfficerId", "acceptingAuthorityId"] as const;
    for (const field of officerFields) {
      if (v[field] && v[field] === v.employeeId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "SELF_OFFICER" });
      }
    }
    const distinctPairs: Array<[typeof officerFields[number], typeof officerFields[number]]> = [
      ["reviewingOfficerId", "reportingOfficerId"],
      ["acceptingAuthorityId", "reportingOfficerId"],
      ["acceptingAuthorityId", "reviewingOfficerId"],
    ];
    for (const [field, other] of distinctPairs) {
      if (v[field] && v[other] && v[field] === v[other]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "NOT_DISTINCT" });
      }
    }
  });

function financialYearOptions(count = 6): string[] {
  const now = new Date();
  // Indian FY runs Apr(3, 0-indexed)-Mar; Jan-Mar is still the FY that
  // started the previous calendar year.
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: count }, (_, i) => {
    const y = fyStartYear - i;
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  });
}

export default function AparNewForm() {
  const t = useTranslations("aparNew");
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [msg, setMsg] = useState("");
  const formError = useFormError("APAR");
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const periodOptions = useMemo(() => financialYearOptions(), []);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [appraisalPeriod, setAppraisalPeriod] = useState(periodOptions[0] ?? "");
  const [reportingOfficerId, setReportingOfficerId] = useState<string | null>(null);
  const [reviewingOfficerId, setReviewingOfficerId] = useState<string | null>(null);
  const [acceptingAuthorityId, setAcceptingAuthorityId] = useState<string | null>(null);

  const CLIENT_MESSAGES: Record<string, string> = {
    REQUIRED: t("validationRequired"),
    SELF_OFFICER: t("validationSelfOfficer"),
    NOT_DISTINCT: t("validationNotDistinct"),
  };

  function fieldError(name: string): string | undefined {
    // Server-derived errors take priority over a stale client-side one for
    // the same field (Field.tsx's own documented convention).
    return formError.fieldError(name) ?? clientErrors[name];
  }

  /** Excludes ids already chosen in the OTHER three slots from a picker's own search results (fix step 2). */
  function excluding(...ids: Array<string | null>) {
    const exclude = new Set(ids.filter((id): id is string => !!id));
    return async (query: string, signal: AbortSignal) => {
      const results = await searchEmployees(query, signal);
      return results.filter((opt) => !exclude.has(opt.id));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const candidate = { employeeId, appraisalPeriod, reportingOfficerId, reviewingOfficerId, acceptingAuthorityId };
    const parsed = aparNewSchema.safeParse(candidate);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "");
        if (field) next[field] = CLIENT_MESSAGES[issue.message] ?? issue.message;
      }
      setClientErrors(next);
      return;
    }
    setClientErrors({});
    setStatus("submitting");
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/hrms/apar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setMsg(resolved.message);
        setStatus("error");
        return;
      }
      const data = await res.json() as { id?: string };
      router.push(`/hr/apar/${data.id}`);
    } catch {
      setMsg(formError.fromException("save").message);
      setStatus("error");
    }
  }

  const canSubmit = !!employeeId && !!appraisalPeriod && !!reportingOfficerId && !!reviewingOfficerId && !!acceptingAuthorityId;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/apar" backLabel="Back to APAR" />

      <div style={{ maxWidth: 600, marginTop: 20 }}>
      <Card title={t("cardTitle")}>
        <form onSubmit={handleSubmit} style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label={t("employeeLabel")} required error={fieldError("employeeId")}>
            <EntityPicker
              value={employeeId}
              onChange={(v) => setEmployeeId(Array.isArray(v) ? v[0] ?? null : v)}
              search={excluding(reportingOfficerId, reviewingOfficerId, acceptingAuthorityId)}
              resolve={resolveEmployees}
              placeholder={t("selectEmployee")}
              noResultsText={t("noResultsText")}
              searchingText={t("searchingText")}
            />
          </Field>

          <Field label={t("periodLabel")} required>
            <Select value={appraisalPeriod} onChange={(e) => setAppraisalPeriod(e.target.value)}>
              {periodOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </Field>

          <Field label={t("reportingOfficerLabel")} required error={fieldError("reportingOfficerId")}>
            <EntityPicker
              value={reportingOfficerId}
              onChange={(v) => setReportingOfficerId(Array.isArray(v) ? v[0] ?? null : v)}
              search={excluding(employeeId, reviewingOfficerId, acceptingAuthorityId)}
              resolve={resolveEmployees}
              placeholder={t("selectEmployee")}
              noResultsText={t("noResultsText")}
              searchingText={t("searchingText")}
            />
          </Field>

          <Field label={t("reviewingOfficerLabel")} required error={fieldError("reviewingOfficerId")}>
            <EntityPicker
              value={reviewingOfficerId}
              onChange={(v) => setReviewingOfficerId(Array.isArray(v) ? v[0] ?? null : v)}
              search={excluding(employeeId, reportingOfficerId, acceptingAuthorityId)}
              resolve={resolveEmployees}
              placeholder={t("selectEmployee")}
              noResultsText={t("noResultsText")}
              searchingText={t("searchingText")}
            />
          </Field>

          <Field label={t("acceptingAuthorityLabel")} required error={fieldError("acceptingAuthorityId")}>
            <EntityPicker
              value={acceptingAuthorityId}
              onChange={(v) => setAcceptingAuthorityId(Array.isArray(v) ? v[0] ?? null : v)}
              search={excluding(employeeId, reportingOfficerId, reviewingOfficerId)}
              resolve={resolveEmployees}
              placeholder={t("selectEmployee")}
              noResultsText={t("noResultsText")}
              searchingText={t("searchingText")}
            />
          </Field>

          {msg && (
            <p role="alert" style={{ color: "var(--red, #c00)", fontSize: 13 }}>
              {msg}
            </p>
          )}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <Link href="/hr/apar" className="btn ghost">{t("cancelBtn")}</Link>
            <Button type="submit" variant="primary" disabled={status === "submitting" || !canSubmit}>
              {status === "submitting" ? t("initiatingBtn") : t("initiateBtn")}
            </Button>
          </div>
        </form>
      </Card>
      </div>
    </div>
  );
}
