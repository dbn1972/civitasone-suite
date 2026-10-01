"use client";
/**
 * AparStageActions — GAP-HR-APAR-DETAIL-01.
 *
 * The six backend stage-transition routes (apar/routes.ts: self-appraisal,
 * reporting, reviewing, accept, representation, finalise) had no web
 * caller at all before this: the detail page only ever rendered a static
 * "use the API" notice, so the entire DoPT/SPARROW APAR workflow -- the
 * actual point of this page -- could not be performed from the UI.
 *
 * This component never decides for itself whether the current viewer may
 * act: `actions` comes straight from GET /v1/hrms/apar/:id's
 * server-computed `computeAparActions` (apar/routes.ts), which mirrors
 * `assertStageOwner`'s own ownership chain. The server call itself is the
 * real authority either way -- a stale `actions` value (e.g. two tabs
 * open) just means the POST below 403s/409s and the user sees the same
 * clerk-safe error any other save failure would show, never a client-side
 * "guess" about who may act.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, Button, ActionButton, Field, Input, Textarea, Select } from "../../../../_components/ds";
import { useFormError, type UseFormErrorResult } from "@/lib/useFormError";

export interface AparActions {
  expectedStage: string;
  canAct: boolean;
  isOverride: boolean;
  canFinalise: boolean;
}

interface Props {
  appraisalId: string;
  status: string;
  actions: AparActions;
}

type Shared = {
  busy: boolean;
  formError: UseFormErrorResult;
  t: ReturnType<typeof useTranslations>;
};

export function AparStageActions({ appraisalId, status, actions }: Props) {
  const t = useTranslations("aparStageActions");
  const router = useRouter();
  const formError = useFormError("APAR");
  const [busy, setBusy] = useState(false);

  // GAP-HR-APAR-DETAIL-01 fix step 3: writes here are queued
  // (publishF3Write), same as everywhere else in this module -- a success
  // response means "accepted", not "already reflected below". router.
  // refresh() re-fetches the server component; if the queue hasn't caught
  // up yet the user briefly sees the pre-transition state rather than a
  // stale cache, and can refresh again.
  async function doPost(path: string, body: unknown): Promise<Response> {
    setBusy(true);
    try {
      return await fetch(`/api/proxy/v1/hrms/apar/${appraisalId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } finally {
      setBusy(false);
    }
  }

  /**
   * For the plain-submit stages (self-appraisal/reporting/reviewing/
   * representation): never throws, reports failure via the shared
   * `formError` banner above, same pattern as AparNewForm.
   */
  async function post(path: string, body: unknown): Promise<boolean> {
    formError.clear();
    try {
      const res = await doPost(path, body);
      if (!res.ok) {
        await formError.fromResponse(res, "save");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      formError.fromException("save");
      return false;
    }
  }

  /**
   * For the two ActionButton/ConfirmDialog stages (accept/finalise):
   * useConfirmAction only keeps its dialog open and shows its OWN error
   * when `onConfirm` throws (see ActionButton.tsx) -- returning false the
   * way `post()` does would make a 403/409 look like a silent success and
   * close the dialog. Still populates the shared `formError` banner too,
   * so the failure is visible even after the dialog is dismissed.
   */
  async function postOrThrow(path: string, body: unknown): Promise<void> {
    formError.clear();
    let res: Response;
    try {
      res = await doPost(path, body);
    } catch {
      throw new Error(formError.fromException("save").message);
    }
    if (!res.ok) {
      throw new Error((await formError.fromResponse(res, "save")).message);
    }
    router.refresh();
  }

  const shared: Shared = { busy, formError, t };

  return (
    <Card title={t("title")}>
      <div style={{ padding: "16px 20px", display: "grid", gap: 16 }}>
        {actions.isOverride && (
          <div
            role="note"
            style={{
              padding: "8px 12px", borderRadius: 8,
              background: "var(--warnbg, #fffbeb)", border: "1px solid var(--warn, #b45309)",
              color: "var(--warn, #92400e)", fontSize: 13, fontWeight: 600,
            }}
          >
            ⚠ {t("overrideNotice")}
          </div>
        )}
        {formError.message && (
          <p role="alert" style={{ color: "var(--red, #c00)", fontSize: 13, margin: 0 }}>
            {formError.message}
          </p>
        )}

        {actions.canAct && status === "self_pending" && (
          <SelfAppraisalForm {...shared} onSubmit={(v) => post("self-appraisal", v)} />
        )}
        {actions.canAct && status === "reporting_officer" && (
          <ReportingForm {...shared} onSubmit={(v) => post("reporting", v)} />
        )}
        {actions.canAct && status === "reviewing_officer" && (
          <ReviewingForm {...shared} onSubmit={(v) => post("reviewing", v)} />
        )}
        {actions.canAct && status === "accepting_authority" && (
          <AcceptingForm {...shared} onSubmit={(v) => postOrThrow("accept", v)} />
        )}
        {actions.canAct && status === "disclosed" && (
          <RepresentationForm {...shared} onSubmit={(v) => post("representation", v)} />
        )}
        {actions.canFinalise && <FinaliseAction {...shared} onConfirm={() => postOrThrow("finalise", {})} />}
      </div>
    </Card>
  );
}

function SelfAppraisalForm({ busy, formError, t, onSubmit }: Shared & { onSubmit: (body: { selfAppraisal: string }) => Promise<boolean> }) {
  const [selfAppraisal, setSelfAppraisal] = useState("");
  const canSubmit = selfAppraisal.trim().length > 0 && selfAppraisal.length <= 8000;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        await onSubmit({ selfAppraisal });
      }}
      style={{ display: "grid", gap: 12 }}
    >
      <h3 style={{ margin: 0, fontSize: 14 }}>{t("selfAppraisalSectionTitle")}</h3>
      <Field label={t("selfAppraisalLabel")} required error={formError.fieldError("selfAppraisal")}>
        <Textarea
          value={selfAppraisal}
          onChange={(e) => setSelfAppraisal(e.target.value)}
          placeholder={t("selfAppraisalPlaceholder")}
          maxLength={8000}
          rows={6}
          required
        />
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={busy || !canSubmit}>
          {busy ? t("savingBtn") : t("submitSelfAppraisalBtn")}
        </Button>
      </div>
    </form>
  );
}

type KraRow = { attribute: string; weight: string; score: string; remarks: string };
function newKraRow(): KraRow {
  return { attribute: "", weight: "", score: "", remarks: "" };
}

function ReportingForm({
  busy, formError, t, onSubmit,
}: Shared & {
  onSubmit: (body: {
    penPicture: string;
    scores: { attribute: string; weight: number; score: number; remarks?: string }[];
  }) => Promise<boolean>;
}) {
  const [penPicture, setPenPicture] = useState("");
  const [rows, setRows] = useState<KraRow[]>([newKraRow()]);

  const totalWeight = rows.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);
  const weightsOk = Math.round(totalWeight * 100) / 100 === 100;
  const rowsOk = rows.length > 0 && rows.every((r) => {
    const score = Number(r.score);
    return r.attribute.trim().length > 0 && Number.isInteger(score) && score >= 1 && score <= 10 && Number(r.weight) > 0;
  });
  const canSubmit = penPicture.trim().length > 0 && penPicture.length <= 8000 && weightsOk && rowsOk;

  function updateRow(i: number, patch: Partial<KraRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        await onSubmit({
          penPicture,
          scores: rows.map((r) => ({
            attribute: r.attribute.trim(),
            weight: Number(r.weight),
            score: Number(r.score),
            ...(r.remarks.trim() ? { remarks: r.remarks.trim() } : {}),
          })),
        });
      }}
      style={{ display: "grid", gap: 12 }}
    >
      <h3 style={{ margin: 0, fontSize: 14 }}>{t("reportingSectionTitle")}</h3>
      <Field label={t("penPictureLabel")} required error={formError.fieldError("penPicture")}>
        <Textarea
          value={penPicture}
          onChange={(e) => setPenPicture(e.target.value)}
          placeholder={t("penPicturePlaceholder")}
          maxLength={8000}
          rows={5}
          required
        />
      </Field>

      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 2fr auto", gap: 8, alignItems: "end" }}>
            <Field label={i === 0 ? t("kraAttributeLabel") : ""}>
              <Input value={row.attribute} onChange={(e) => updateRow(i, { attribute: e.target.value })} maxLength={64} required aria-label={t("kraAttributeLabel")} />
            </Field>
            <Field label={i === 0 ? t("kraWeightLabel") : ""}>
              <Input type="number" min={0.01} max={100} step="any" value={row.weight} onChange={(e) => updateRow(i, { weight: e.target.value })} required aria-label={t("kraWeightLabel")} />
            </Field>
            <Field label={i === 0 ? t("kraScoreLabel") : ""}>
              <Input type="number" min={1} max={10} step={1} value={row.score} onChange={(e) => updateRow(i, { score: e.target.value })} required aria-label={t("kraScoreLabel")} />
            </Field>
            <Field label={i === 0 ? t("kraRemarksLabel") : ""}>
              <Input value={row.remarks} onChange={(e) => updateRow(i, { remarks: e.target.value })} maxLength={2000} aria-label={t("kraRemarksLabel")} />
            </Field>
            <Button
              type="button"
              variant="ghost"
              disabled={rows.length <= 1}
              onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
              aria-label={t("removeKraAriaLabel")}
            >
              ×
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" variant="ghost" onClick={() => setRows((prev) => [...prev, newKraRow()])}>
            {t("addKraBtn")}
          </Button>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: weightsOk ? "var(--good, #16a34a)" : "var(--warn, #b45309)" }}>
          {t("weightSumLabel", { sum: totalWeight })}
          {!weightsOk && ` — ${t("weightSumError")}`}
        </p>
      </div>

      <div>
        <Button type="submit" variant="primary" disabled={busy || !canSubmit}>
          {busy ? t("savingBtn") : t("submitReportingBtn")}
        </Button>
      </div>
    </form>
  );
}

type VariationRow = { attribute: string; score: string };

function ReviewingForm({
  busy, formError, t, onSubmit,
}: Shared & {
  onSubmit: (body: { decision: "concur" | "vary"; remarks: string; variations?: { attribute: string; score: number }[] }) => Promise<boolean>;
}) {
  const [decision, setDecision] = useState<"concur" | "vary">("concur");
  const [remarks, setRemarks] = useState("");
  const [variations, setVariations] = useState<VariationRow[]>([]);

  const variationsOk = variations.every((v) => {
    const score = Number(v.score);
    return v.attribute.trim().length > 0 && Number.isInteger(score) && score >= 1 && score <= 10;
  });
  const canSubmit = remarks.trim().length > 0 && remarks.length <= 8000 && (decision === "concur" || variationsOk);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        await onSubmit({
          decision,
          remarks,
          ...(decision === "vary" && variations.length > 0
            ? { variations: variations.map((v) => ({ attribute: v.attribute.trim(), score: Number(v.score) })) }
            : {}),
        });
      }}
      style={{ display: "grid", gap: 12 }}
    >
      <h3 style={{ margin: 0, fontSize: 14 }}>{t("reviewingSectionTitle")}</h3>
      <Field label={t("decisionLabel")} required>
        <Select value={decision} onChange={(e) => setDecision(e.target.value as "concur" | "vary")}>
          <option value="concur">{t("decisionConcur")}</option>
          <option value="vary">{t("decisionVary")}</option>
        </Select>
      </Field>
      <Field label={t("reviewingRemarksLabel")} required error={formError.fieldError("remarks")}>
        <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={8000} rows={4} required />
      </Field>

      {decision === "vary" && (
        <div style={{ display: "grid", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{t("variationsLabel")}</p>
          {variations.map((v, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8 }}>
              <Input
                value={v.attribute}
                onChange={(e) => setVariations((prev) => prev.map((row, idx) => (idx === i ? { ...row, attribute: e.target.value } : row)))}
                placeholder={t("kraAttributeLabel")}
                aria-label={t("kraAttributeLabel")}
                maxLength={64}
              />
              <Input
                type="number" min={1} max={10} step={1}
                value={v.score}
                onChange={(e) => setVariations((prev) => prev.map((row, idx) => (idx === i ? { ...row, score: e.target.value } : row)))}
                placeholder={t("kraScoreLabel")}
                aria-label={t("kraScoreLabel")}
              />
              <Button type="button" variant="ghost" onClick={() => setVariations((prev) => prev.filter((_, idx) => idx !== i))} aria-label={t("removeKraAriaLabel")}>
                ×
              </Button>
            </div>
          ))}
          <div>
            <Button type="button" variant="ghost" onClick={() => setVariations((prev) => [...prev, { attribute: "", score: "" }])}>
              {t("addVariationBtn")}
            </Button>
          </div>
        </div>
      )}

      <div>
        <Button type="submit" variant="primary" disabled={busy || !canSubmit}>
          {busy ? t("savingBtn") : t("submitReviewingBtn")}
        </Button>
      </div>
    </form>
  );
}

function AcceptingForm({ busy, formError, t, onSubmit }: Shared & { onSubmit: (body: { remarks: string }) => Promise<void> }) {
  const [remarks, setRemarks] = useState("");
  const canSubmit = remarks.trim().length > 0 && remarks.length <= 8000;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>{t("acceptingSectionTitle")}</h3>
      <Field label={t("acceptRemarksLabel")} required error={formError.fieldError("remarks")}>
        <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={8000} rows={4} required />
      </Field>
      <div>
        {/* GAP-HR-APAR-DETAIL-01: the grade is server-computed and the
            record moves to 'disclosed' on Accept -- scores are final
            afterwards, so this is behind a confirm dialog, not a plain
            submit like the earlier stages. */}
        <ActionButton
          label={busy ? t("savingBtn") : t("submitAcceptBtn")}
          disabled={busy || !canSubmit}
          confirmTitle={t("acceptConfirmTitle")}
          confirmDescription={t("acceptConfirmMessage")}
          onConfirm={() => onSubmit({ remarks })}
        />
      </div>
    </div>
  );
}

function RepresentationForm({ busy, formError, t, onSubmit }: Shared & { onSubmit: (body: { representation: string }) => Promise<boolean> }) {
  const [representation, setRepresentation] = useState("");
  const canSubmit = representation.trim().length > 0 && representation.length <= 8000;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        await onSubmit({ representation });
      }}
      style={{ display: "grid", gap: 12 }}
    >
      <h3 style={{ margin: 0, fontSize: 14 }}>{t("representationSectionTitle")}</h3>
      <Field label={t("representationLabel")} required error={formError.fieldError("representation")}>
        <Textarea
          value={representation}
          onChange={(e) => setRepresentation(e.target.value)}
          placeholder={t("representationPlaceholder")}
          maxLength={8000}
          rows={4}
          required
        />
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={busy || !canSubmit}>
          {busy ? t("savingBtn") : t("submitRepresentationBtn")}
        </Button>
      </div>
    </form>
  );
}

function FinaliseAction({ busy, t, onConfirm }: Shared & { onConfirm: () => Promise<void> }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>{t("finaliseSectionTitle")}</h3>
      <div>
        <ActionButton
          label={busy ? t("savingBtn") : t("finaliseBtn")}
          disabled={busy}
          danger
          confirmTitle={t("finaliseConfirmTitle")}
          confirmDescription={t("finaliseConfirmMessage")}
          onConfirm={() => onConfirm()}
        />
      </div>
    </div>
  );
}
