"use client";
/**
 * ScoreParamsEditor -- GAP-CRM-LEAD-SCORING-02. The structured form behind a lead
 * scoring rule's `params`: instead of asking an admin to type the params JSON for
 * their score function, it shows the inputs that function actually reads --
 * presence: two scores; map: value -> score rows + a default; recency / numeric
 * threshold: tier rows + the fallbacks -- each with its own inline error
 * (role="alert", linked with aria-describedby). The model, per-field validation and
 * the draft <-> params conversion live in lib/crm/leadScoreParams.ts and mirror what
 * crm-service's buildScoreFn reads.
 */
import { useTranslations } from "next-intl";
import { Button } from "../ds";
import { tierBoundKey, type ParamIssue, type ParamsDraft } from "@/lib/crm/leadScoreParams";
import type { ScoreFnType } from "@/lib/crm/leadQualification";

const inputStyle = { padding: 6, minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;
const labelStyle = { fontSize: 11, color: "var(--muted)" } as const;
const errorStyle = { fontSize: 11, color: "#b42318" } as const;

interface FieldProps {
  id: string;
  label: string;
  ariaLabel: string;
  value: string;
  onValue: (v: string) => void;
  /** Resolved (already translated) inline error for this field, if any. */
  error?: string | undefined;
  type?: "number" | "text";
  placeholder?: string;
  min?: number;
  max?: number;
  width: number;
}

/** One labelled input with its own inline error. Module-level so typing never remounts it. */
function Field({ id, label, ariaLabel, value, onValue, error, type = "number", placeholder, min, max, width }: FieldProps) {
  const errId = `${id}-err`;
  return (
    <div style={{ display: "grid", gap: 2, width }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        {...(type === "number" ? { step: "any" } : {})}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        onChange={(e) => onValue(e.target.value)}
        style={inputStyle}
      />
      {error ? (
        <span id={errId} role="alert" style={errorStyle}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface Props {
  /** Unique id prefix for this rule's controls. */
  idPrefix: string;
  /** 1-based rule number, used in accessible names so repeated labels stay distinguishable. */
  ruleNumber: number;
  type: ScoreFnType;
  draft: ParamsDraft;
  issues: ParamIssue[];
  onChange: (next: ParamsDraft) => void;
}

export function ScoreParamsEditor({ idPrefix, ruleNumber, type, draft, issues, onChange }: Props) {
  const t = useTranslations("crmLeadScoreRulesEditor");
  const set = (patch: Partial<ParamsDraft>) => onChange({ ...draft, ...patch });
  const errorFor = (field: string): string | undefined => {
    const issue = issues.find((i) => i.field === field);
    return issue ? t(`err_${issue.code}`, { bound: tierBoundKey(type) }) : undefined;
  };
  const idFor = (field: string) => `${idPrefix}-${field.replace(/\./g, "-")}`;
  const aria = (label: string) => t("fieldForRule", { field: label, n: ruleNumber });

  const explain = <p style={{ ...labelStyle, margin: "0 0 6px" }}>{t(`explain_${type}`)}</p>;

  if (type === "presence") {
    return (
      <div>
        {explain}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field id={idFor("present")} label={t("presentLabel")} ariaLabel={aria(t("presentLabel"))} value={draft.present} placeholder="100" min={0} max={100} width={150} error={errorFor("present")} onValue={(v) => set({ present: v })} />
          <Field id={idFor("absent")} label={t("absentLabel")} ariaLabel={aria(t("absentLabel"))} value={draft.absent} placeholder="0" min={0} max={100} width={150} error={errorFor("absent")} onValue={(v) => set({ absent: v })} />
        </div>
      </div>
    );
  }

  if (type === "map") {
    return (
      <div>
        {explain}
        <div style={{ display: "grid", gap: 8 }}>
          {draft.mapRows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
              <Field
                id={idFor(`mapKey.${i}`)}
                type="text"
                label={t("mapValueLabel")}
                ariaLabel={aria(t("mapValueLabelN", { n: i + 1 }))}
                value={row.key}
                placeholder="referral"
                width={170}
                error={errorFor(`mapKey.${i}`)}
                onValue={(v) => set({ mapRows: draft.mapRows.map((r, j) => (j === i ? { ...r, key: v } : r)) })}
              />
              <Field
                id={idFor(`mapScore.${i}`)}
                label={t("scoreLabel")}
                ariaLabel={aria(t("mapScoreLabelN", { n: i + 1 }))}
                value={row.score}
                min={0}
                max={100}
                width={100}
                error={errorFor(`mapScore.${i}`)}
                onValue={(v) => set({ mapRows: draft.mapRows.map((r, j) => (j === i ? { ...r, score: v } : r)) })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("removeMapRow", { n: i + 1, rule: ruleNumber })}
                onClick={() => set({ mapRows: draft.mapRows.filter((_, j) => j !== i) })}
                style={{ marginTop: 18 }}
              >
                {t("removeRow")}
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("addMapRowFor", { n: ruleNumber })}
              onClick={() => set({ mapRows: [...draft.mapRows, { key: "", score: "" }] })}
            >
              {t("addMapRow")}
            </Button>
          </div>
          <Field id={idFor("defaultScore")} label={t("mapDefaultLabel")} ariaLabel={aria(t("mapDefaultLabel"))} value={draft.defaultScore} placeholder="0" min={0} max={100} width={220} error={errorFor("defaultScore")} onValue={(v) => set({ defaultScore: v })} />
        </div>
      </div>
    );
  }

  // recency + numeric_threshold: tier rows.
  const isRecency = type === "recency";
  const boundLabel = isRecency ? t("tierDaysLabel") : t("tierMinLabel");
  return (
    <div>
      {explain}
      <div style={{ display: "grid", gap: 8 }}>
        {draft.tiers.map((tier, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            <Field
              id={idFor(`tierBound.${i}`)}
              label={boundLabel}
              ariaLabel={aria(t("tierBoundN", { label: boundLabel, n: i + 1 }))}
              value={tier.bound}
              {...(isRecency ? { min: 0 } : {})}
              width={160}
              error={errorFor(`tierBound.${i}`)}
              onValue={(v) => set({ tiers: draft.tiers.map((r, j) => (j === i ? { ...r, bound: v } : r)) })}
            />
            <Field
              id={idFor(`tierScore.${i}`)}
              label={t("scoreLabel")}
              ariaLabel={aria(t("tierScoreN", { n: i + 1 }))}
              value={tier.score}
              min={0}
              max={100}
              width={100}
              error={errorFor(`tierScore.${i}`)}
              onValue={(v) => set({ tiers: draft.tiers.map((r, j) => (j === i ? { ...r, score: v } : r)) })}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("removeTier", { n: i + 1, rule: ruleNumber })}
              onClick={() => set({ tiers: draft.tiers.filter((_, j) => j !== i) })}
              style={{ marginTop: 18 }}
            >
              {t("removeRow")}
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t("addTierFor", { n: ruleNumber })}
            onClick={() => set({ tiers: [...draft.tiers, { bound: "", score: "" }] })}
          >
            {t("addTier")}
          </Button>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {isRecency ? (
            <>
              <Field id={idFor("beyondScore")} label={t("beyondLabel")} ariaLabel={aria(t("beyondLabel"))} value={draft.beyondScore} placeholder="0" min={0} max={100} width={220} error={errorFor("beyondScore")} onValue={(v) => set({ beyondScore: v })} />
              <Field id={idFor("absentScore")} label={t("noDateLabel")} ariaLabel={aria(t("noDateLabel"))} value={draft.absentScore} placeholder="0" min={0} max={100} width={220} error={errorFor("absentScore")} onValue={(v) => set({ absentScore: v })} />
            </>
          ) : (
            <Field id={idFor("defaultScore")} label={t("belowFirstTierLabel")} ariaLabel={aria(t("belowFirstTierLabel"))} value={draft.defaultScore} placeholder="0" min={0} max={100} width={220} error={errorFor("defaultScore")} onValue={(v) => set({ defaultScore: v })} />
          )}
        </div>
      </div>
    </div>
  );
}
