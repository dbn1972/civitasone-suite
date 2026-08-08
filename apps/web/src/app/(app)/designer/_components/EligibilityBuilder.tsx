"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, EmptyState } from "@/app/_components/ds";
import {
  EligibilityConditionBuilder,
  type FormFieldDefinition,
} from "@/app/_components/ds/designer";
import type { EligibilityDesignState } from "@/app/_components/ds/designer/eligibilityTypes";
import {
  buildSampleSubjectFields,
  evaluateEligibilityLocal,
  outcomeLabel,
  persistEligibilityDesign,
  subjectFromSampleValues,
  suggestFailingSampleValues,
  suggestPassingSampleValues,
} from "../_data/eligibilityBuilderApi";

interface Props {
  serviceId: string;
  serviceName: string;
  initial: EligibilityDesignState;
  formFields: FormFieldDefinition[];
  onSaveState?: (state: "saving" | "saved" | "offline") => void;
  onDesignPersisted?: (design: EligibilityDesignState) => void;
}

export function EligibilityBuilder({
  serviceId,
  serviceName,
  initial,
  formFields,
  onSaveState,
  onDesignPersisted,
}: Props) {
  const [design, setDesign] = useState(initial);
  const [sampleValues, setSampleValues] = useState<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(design);
  latest.current = design;

  const sampleFields = useMemo(
    () => buildSampleSubjectFields(design.rules, formFields),
    [design.rules, formFields],
  );

  const profileSampleFields = sampleFields.filter((f) => f.group === "profile");
  const formSampleFields = sampleFields.filter((f) => f.group === "form");

  const testResult = useMemo(() => {
    if (design.rules.length === 0) return null;
    const subject = subjectFromSampleValues(sampleFields, sampleValues);
    return evaluateEligibilityLocal(design.rules, subject);
  }, [design.rules, sampleFields, sampleValues]);

  const ruleHighlights = useMemo(() => {
    if (!testResult) return undefined;
    const map: Record<string, "pass" | "fail"> = {};
    for (const r of testResult.reasons) {
      map[r.ruleId] = r.passed ? "pass" : "fail";
    }
    return map;
  }, [testResult]);

  const schedulePersist = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      onSaveState?.("saving");
      try {
        const saved = await persistEligibilityDesign(latest.current, serviceId, serviceName);
        setDesign(saved);
        onDesignPersisted?.(saved);
        onSaveState?.("saved");
      } catch {
        onSaveState?.("offline");
      }
    }, 2000);
  }, [onDesignPersisted, onSaveState, serviceId, serviceName]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { schedulePersist(); }, [design, schedulePersist]);

  const updateRules = (rules: EligibilityDesignState["rules"]) => {
    setDesign((d) => ({ ...d, rules }));
  };

  const renderSampleField = (f: (typeof sampleFields)[number]) => (
    <label key={f.id} style={{ display: "grid", gap: 4, fontSize: 13 }}>
      <span style={{ fontWeight: 600 }}>{f.label}</span>
      {f.valueType === "boolean" ? (
        <select
          className="input"
          value={sampleValues[f.id] ?? ""}
          onChange={(e) => setSampleValues((v) => ({ ...v, [f.id]: e.target.value }))}
          aria-label={f.label}
        >
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : (
        <input
          className="input"
          type={f.valueType === "number" ? "number" : "text"}
          value={sampleValues[f.id] ?? ""}
          onChange={(e) => setSampleValues((v) => ({ ...v, [f.id]: e.target.value }))}
          aria-label={f.label}
        />
      )}
    </label>
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card>
        <div className="pad">
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Who can apply?</h3>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--mut)" }}>
            Set optional conditions on applicant profile or form answers. Leave empty if everyone may apply.
          </p>
          <EligibilityConditionBuilder
            rules={design.rules}
            formFields={formFields}
            onChange={updateRules}
            ruleHighlights={ruleHighlights}
          />
        </div>
      </Card>

      {design.rules.length === 0 ? (
        <EmptyState
          title="No eligibility conditions"
          message="Everyone may apply — that's fine for most services. Add a condition above if you need to restrict or flag applicants."
        />
      ) : (
        <Card>
          <div className="pad">
            <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Test against a sample applicant</h3>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--mut)" }}>
              Fill sample values to see whether each condition passes or fails. Failing rules are highlighted in the list above.
            </p>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setSampleValues(suggestPassingSampleValues(design.rules, formFields))}
              >
                Fill eligible sample
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setSampleValues(suggestFailingSampleValues(design.rules, formFields))}
              >
                Fill failing sample
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setSampleValues({})}
              >
                Clear sample
              </button>
            </div>

            <div style={{ display: "grid", gap: 16, maxWidth: 520 }}>
              {profileSampleFields.length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--ink2)" }}>
                    Applicant profile
                  </p>
                  {profileSampleFields.map(renderSampleField)}
                </div>
              ) : null}
              {formSampleFields.length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--ink2)" }}>
                    Form answers
                  </p>
                  {formSampleFields.map(renderSampleField)}
                </div>
              ) : null}
            </div>

            {testResult ? (
              <div
                role="status"
                style={{
                  marginTop: 16,
                  padding: 12,
                  borderRadius: "var(--r-sm)",
                  border: "1px solid var(--line)",
                  background:
                    testResult.outcome === "eligible" ? "var(--good-bg)"
                      : testResult.outcome === "not_eligible" ? "var(--bad-bg)"
                        : "var(--warn-bg)",
                }}
              >
                <p
                  style={{
                    margin: "0 0 8px",
                    fontWeight: 600,
                    color:
                      testResult.outcome === "eligible" ? "var(--good-fg)"
                        : testResult.outcome === "not_eligible" ? "var(--bad-fg)"
                          : "var(--warn-fg)",
                  }}
                >
                  Outcome: {outcomeLabel(testResult.outcome)}
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {testResult.reasons.map((r) => {
                    const rule = design.rules.find((x) => x.id === r.ruleId);
                    return (
                      <li
                        key={r.ruleId}
                        style={{
                          color: r.passed ? "var(--good-fg)" : "var(--bad-fg)",
                          fontWeight: r.passed ? 400 : 600,
                          marginBottom: 4,
                        }}
                      >
                        {r.message}
                        {!r.passed && rule ? (
                          <span style={{ color: "var(--mut)", fontWeight: 400 }}>
                            {" "}· effect: {rule.effect === "block" ? "Block" : rule.effect === "warn" ? "Warn" : "Flag for review"}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </Card>
      )}
    </div>
  );
}
