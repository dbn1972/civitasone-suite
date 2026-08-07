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
  persistEligibilityDesign,
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

  const testResult = useMemo(() => {
    if (design.rules.length === 0) return null;
    const subject: Record<string, unknown> = {};
    for (const f of sampleFields) {
      const raw = sampleValues[f.id] ?? "";
      if (f.valueType === "number") subject[f.id] = raw === "" ? undefined : Number(raw);
      else if (f.valueType === "boolean") subject[f.id] = raw === "true";
      else subject[f.id] = raw;
    }
    return evaluateEligibilityLocal(design.rules, subject);
  }, [design.rules, sampleFields, sampleValues]);

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
              Fill sample values to see whether each condition passes or fails.
            </p>
            <div style={{ display: "grid", gap: 10, maxWidth: 480 }}>
              {sampleFields.map((f) => (
                <label key={f.id} style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{f.label}</span>
                  {f.valueType === "boolean" ? (
                    <select
                      className="input"
                      value={sampleValues[f.id] ?? ""}
                      onChange={(e) => setSampleValues((v) => ({ ...v, [f.id]: e.target.value }))}
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
                    />
                  )}
                </label>
              ))}
            </div>
            {testResult ? (
              <div style={{ marginTop: 16 }}>
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
                  Outcome: {testResult.outcome === "eligible" ? "Eligible" : testResult.outcome === "not_eligible" ? "Not eligible" : "Flagged for review"}
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {testResult.reasons.map((r) => (
                    <li
                      key={r.ruleId}
                      style={{
                        color: r.passed ? "var(--good-fg)" : "var(--bad-fg)",
                        fontWeight: r.passed ? 400 : 600,
                      }}
                    >
                      {r.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Card>
      )}
    </div>
  );
}
