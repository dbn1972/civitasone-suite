"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, Field, Input } from "../../../../../_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { useFormError } from "@/lib/useFormError";
import { useAsyncMutation } from "@/lib/useAsyncMutation";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import {
  blankDraft, checkSlabDrafts, draftFromSlab, effectiveDateIssue, isBackDated, slabGaps,
  type SlabDraft, type SlabField, type SlabIssue,
} from "./slabDrafts";
import type { PtApiSlab } from "./viewModel";

/**
 * GAP-PAYROLL-STATUTORY-PT-04 [HUMAN REVIEW: statutory compliance]: create a
 * new, effective-dated version of a state's professional-tax slabs. The form
 * starts as a copy of the version in force; saving never alters an earlier
 * version. payroll-service is the authority for every rule shown here (422/409
 * codes below); this only saves the round trip.
 */
type Accepted = { id: string };
type Outcome = { status: "pending" | "pending_approval" | "applied" | "rejected" | "declined"; code: string | null };

export function PtVersionForm({
  stateCode, stateName, baseSlabs, today, earliestEffectiveFrom, lastFinalisedMonth,
}: {
  stateCode: string;
  stateName: string;
  baseSlabs: PtApiSlab[];
  today: string;
  earliestEffectiveFrom: string | null;
  lastFinalisedMonth: string | null;
}) {
  const t = useTranslations("ptVersionForm");
  const router = useRouter();
  const formError = useFormError(t("saveArea"));
  const initial = (): SlabDraft[] => (baseSlabs.some(Boolean) ? baseSlabs.map(draftFromSlab) : [blankDraft()]);
  const [rows, setRows] = useState<SlabDraft[]>(initial);
  const [effectiveFrom, setEffectiveFrom] = useState(earliestEffectiveFrom && earliestEffectiveFrom > today ? earliestEffectiveFrom : today);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [problem, setProblem] = useState<{ issue: SlabIssue | "dateRequired" | "dateTooEarly"; row: number; field: SlabField | "date" } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const uid = useId();

  const backDated = isBackDated(effectiveFrom, today);
  const parsed = checkSlabDrafts(rows);
  const gaps = parsed.ok ? slabGaps(parsed.slabs) : [];

  const issueText: Record<string, string> = {
    none: t("errNoSlabs"), from: t("errFrom"), to: t("errTo"), range: t("errRange"), tax: t("errAmount"), feb: t("errFebAmount"),
    cap: t("errCap"), overlap: t("errOverlap"),
    dateRequired: t("errDateRequired"),
    dateTooEarly: t("errDateTooEarly", { date: earliestEffectiveFrom ? formatIndianDate(earliestEffectiveFrom) : "" }),
  };

  const setCell = (i: number, field: SlabField, value: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));

  function review(e: React.FormEvent) {
    e.preventDefault();
    setSaved(null);
    formError.clear();
    const dateIssue = effectiveDateIssue(effectiveFrom, earliestEffectiveFrom);
    if (dateIssue) {
      setProblem({ issue: dateIssue === "required" ? "dateRequired" : "dateTooEarly", row: 0, field: "date" });
      return;
    }
    const check = checkSlabDrafts(rows);
    if (!check.ok) {
      setProblem({ issue: check.issue, row: check.row, field: check.field });
      return;
    }
    setProblem(null);
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  // The POST answers 202 with the command's id; the write (or its rejection, e.g. a
  // concurrent version on the same date) happens later in the consumer. So the form
  // stays "saving" and polls the request's outcome instead of claiming success.
  const reasonRef = useRef<string | undefined>(undefined);
  const knownRejection = (code: string | null | undefined): string | null => {
    const known: Record<string, string> = {
      PT_VERSION_EXISTS: t("errVersionExists"),
      PT_BACKDATE_BEFORE_FINALISED_RUN: t("errBackdateFinalised"),
      PT_BACKDATE_REASON_REQUIRED: t("errReasonRequired"),
      PT_SLAB_OVERLAP: t("errOverlap"),
    };
    return code && known[code] ? known[code] : null;
  };
  const mutation = useAsyncMutation<Accepted, Outcome>({
    mutate: async () => {
      const check = checkSlabDrafts(rows);
      if (!check.ok) throw new Error(issueText[check.issue] ?? t("errNoSlabs"));
      let res: Response;
      try {
        res = await browserFetch("v1/payroll/statutory/pt/versions", {
          method: "POST",
          body: JSON.stringify({ stateCode, effectiveFrom, slabs: check.slabs, ...(reasonRef.current ? { reason: reasonRef.current } : {}) }),
        });
      } catch {
        throw new Error(formError.fromException("save").message);
      }
      if (!res.ok) {
        let code: string | undefined;
        try { code = ((await res.clone().json()) as { code?: string }).code; } catch { code = undefined; }
        throw new Error(knownRejection(code) ?? (await formError.fromResponse(res, "save")).message);
      }
      return (await res.json()) as Accepted;
    },
    poll: async (accepted) => {
      const res = await browserFetch(`v1/payroll/statutory/pt/versions/requests/${encodeURIComponent(accepted.id)}`);
      if (!res.ok) throw new Error("not available");
      return (await res.json()) as Outcome;
    },
    isDone: (o) => o.status !== "pending",
    onConfirmed: (o) => {
      if (o.status === "applied") {
        setConfirmOpen(false);
        setSaved(t("savedMessage", { state: stateCode, date: formatIndianDate(effectiveFrom) }));
        router.refresh();
      } else if (o.status === "pending_approval") {
        // maker != checker: nothing is in force until a DIFFERENT administrator approves.
        setConfirmOpen(false);
        setSaved(t("submittedForApproval", { state: stateCode, date: formatIndianDate(effectiveFrom) }));
        router.refresh();
      } else {
        setDialogError(knownRejection(o.code) ?? t("errRejectedGeneric"));
      }
    },
    onTimeout: () => {
      setConfirmOpen(false);
      setSaved(t("stillProcessing"));
    },
    maxAttempts: 8,
  });
  const busy = mutation.isBusy;
  const shownDialogError = dialogError ?? mutation.error ?? undefined;

  async function save(reason?: string) {
    reasonRef.current = reason;
    setDialogError(undefined);
    mutation.reset();
    await mutation.run();
  }

  const fieldError = (i: number, f: SlabField): string | undefined =>
    problem && problem.row === i && problem.field === f ? issueText[problem.issue] : undefined;

  return (
    <form onSubmit={review} noValidate style={{ marginBottom: 16 }} aria-labelledby={`${uid}-title`}>
      <Card title={t("formTitle", { state: `${stateName} (${stateCode})` })} padding>
        <div style={{ display: "grid", gap: 14 }}>
          <p id={`${uid}-title`} style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{t("formHint")}</p>
          <p role="note" style={{ margin: 0, fontSize: 13 }}>{t("capNote")}</p>
          {lastFinalisedMonth && earliestEffectiveFrom && (
            <p role="note" className="pill warn" style={{ margin: 0, width: "fit-content" }}>
              {t("finalisedNote", { month: lastFinalisedMonth, date: formatIndianDate(earliestEffectiveFrom) })}
            </p>
          )}

          <div style={{ maxWidth: 260 }}>
            <Field label={t("effectiveFromLabel")} required error={problem?.field === "date" ? issueText[problem.issue] : undefined}>
              <Input
                type="date"
                value={effectiveFrom}
                min={earliestEffectiveFrom ?? undefined}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                style={{ minHeight: 44 }}
              />
            </Field>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--mut)" }}>{t("effectiveFromHelp")}</p>
          </div>

          <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
            <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t("slabsLegend")}</legend>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", alignItems: "start" }}>
                <Field label={t("slabFromLabel", { n: i + 1 })} required error={fieldError(i, "from")}>
                  <Input inputMode="decimal" value={r.from} onChange={(e) => setCell(i, "from", e.target.value)} style={{ minHeight: 44 }} />
                </Field>
                <Field label={t("slabToLabel", { n: i + 1 })} error={fieldError(i, "to")}>
                  <Input inputMode="decimal" value={r.to} onChange={(e) => setCell(i, "to", e.target.value)} style={{ minHeight: 44 }} />
                </Field>
                <Field label={t("ptAmountLabel", { n: i + 1 })} required error={fieldError(i, "tax")}>
                  <Input inputMode="decimal" value={r.tax} onChange={(e) => setCell(i, "tax", e.target.value)} style={{ minHeight: 44 }} />
                </Field>
                <Field label={t("februaryLabel", { n: i + 1 })} error={fieldError(i, "feb")}>
                  <Input inputMode="decimal" value={r.feb} onChange={(e) => setCell(i, "feb", e.target.value)} style={{ minHeight: 44 }} />
                </Field>
                <div style={{ alignSelf: "end" }}>
                  <Button
                    type="button" variant="ghost" style={{ minHeight: 44 }}
                    disabled={rows.length < 2}
                    aria-label={t("removeSlab", { n: i + 1 })}
                    onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                  >
                    {t("removeSlabShort")}
                  </Button>
                </div>
              </div>
            ))}
          </fieldset>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={() => setRows((rs) => [...rs, blankDraft()])}>{t("addSlab")}</Button>
            <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={() => { setRows(initial()); setProblem(null); }}>{t("resetToCurrent")}</Button>
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>{busy ? t("savingPending") : t("submitBtn")}</Button>
          </div>

          {saved && <p role="status" aria-live="polite" className="pill good" style={{ width: "fit-content" }}>{saved}</p>}
          {formError.message && !confirmOpen && <p role="alert" className="pill bad" style={{ width: "fit-content" }}>{formError.message}</p>}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={shownDialogError}
        requireReason={backDated}
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel={t("reasonLabel")}
        description={
          <>
            <p style={{ margin: 0 }}>
              {t("confirmDescription", { state: `${stateName} (${stateCode})`, date: formatIndianDate(effectiveFrom), count: parsed.ok ? parsed.slabs.length : 0 })}
            </p>
            {backDated && <p role="note" className="pill warn" style={{ margin: "8px 0 0", width: "fit-content" }}>{t("backDatedWarning")}</p>}
            {gaps.some(Boolean) && (
              <p role="note" className="pill warn" style={{ margin: "8px 0 0", width: "fit-content" }}>
                {t("gapWarning", { gaps: gaps.map((g) => `${formatMoney(g.fromMinor)}–${formatMoney(g.toMinor)}`).join(", ") })}
              </p>
            )}
          </>
        }
        onConfirm={(reason) => void save(reason)}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
