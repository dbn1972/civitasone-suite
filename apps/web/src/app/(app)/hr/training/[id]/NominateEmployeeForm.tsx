"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button, EntityPicker, Field } from "../../../../_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";

export interface NominateEmployeeFormProps {
  trainingId: string;
}

/**
 * GAP-HR-TRAINING-01 (HR-nominates half): POST /v1/hrms/nominations has always
 * let an HR caller (hr_admin / hr_officer / super_admin) nominate ANY employee,
 * while every other caller is pinned server-side to their own record
 * (training/routes.ts resolveOwnEmployeeIdIfNonHr) -- but the only UI was the
 * self-enrol EnrollButton, so HR had no way to nominate a colleague. This is the
 * missing picker. The page only renders it for HR roles; the server is still the
 * authority, so a forged render for anyone else would still be pinned/403'd.
 *
 * The write is queued (202): the nomination lands as "Nominated" on
 * /hr/training/nominations once the consumer runs, so the confirmation says
 * "submitted", not "done".
 */
export function NominateEmployeeForm({ trainingId }: NominateEmployeeFormProps) {
  const t = useTranslations("trainingDetail");
  const router = useRouter();
  const formError = useFormError("training nomination");
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setDone(false);
    formError.clear();
    if (!employeeId) {
      setMissing(true);
      return;
    }
    setMissing(false);
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/hrms/nominations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trainingId, employeeId }),
      });
      if (!res.ok) {
        await formError.fromResponse(res, "save");
        return;
      }
      setDone(true);
      setEmployeeId(null);
      router.refresh();
    } catch (caught) {
      formError.fromException("save", caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={t("nominateTitle")} className="border-t border-slate-100 pt-4 mt-4" style={{ display: "grid", gap: 12, maxWidth: 520 }}>
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{t("nominateTitle")}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{t("nominateHint")}</p>
      </div>

      <Field label={t("nominateEmployeeLabel")} required error={missing ? t("nominateEmployeeRequired") : undefined}>
        <EntityPicker
          value={employeeId}
          onChange={(v) => { setEmployeeId(Array.isArray(v) ? (v[0] ?? null) : v); setMissing(false); setDone(false); }}
          search={searchEmployees}
          resolve={resolveEmployees}
          placeholder={t("nominateEmployeePlaceholder")}
          noResultsText={t("nominateNoResults")}
          searchingText={t("nominateSearching")}
          searchErrorText={t("nominateSearchError")}
        />
      </Field>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Button type="submit" disabled={busy} aria-busy={busy}>
          {busy ? t("nominating") : t("nominateCta")}
        </Button>
        {done && (
          <p role="status" className="text-sm font-medium text-emerald-700" style={{ margin: 0 }}>
            {t("nominationSubmitted")}{" "}
            <Link href="/hr/training/nominations" className="underline">{t("viewNominations")}</Link>
          </p>
        )}
      </div>

      {formError.message && (
        <p role="alert" aria-live="assertive" className="text-sm text-red-600" style={{ margin: 0 }}>{formError.message}</p>
      )}
    </form>
  );
}
