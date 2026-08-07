"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/app/_components/ds";
import {
  FeeExemptionBuilder,
  SlabTableEditor,
  type FormFieldDefinition,
} from "@/app/_components/ds/designer";
import type { FeeDesignState, FeeModelUi } from "@/app/_components/ds/designer/feeTypes";
import { formatMoney } from "@/lib/formatters";
import {
  buildSampleCalculation,
  buildSampleSubjectFields,
  fetchHoaOptions,
  paiseToRupeesInput,
  persistFeeDesign,
  rupeesInputToPaise,
} from "../_data/feeBuilderApi";

interface Props {
  serviceId: string;
  serviceName: string;
  initial: FeeDesignState;
  formFields: FormFieldDefinition[];
  engineAvailable: boolean;
  onSaveState?: (state: "saving" | "saved" | "offline") => void;
  onDesignPersisted?: (design: FeeDesignState) => void;
}

const MODEL_CARDS: { id: FeeModelUi; title: string; description: string }[] = [
  { id: "flat", title: "Fixed fee", description: "One amount, optional exemptions" },
  { id: "slab", title: "Slab or formula", description: "Depends on area, units, category…" },
  { id: "engine", title: "Engine", description: "Computed by an assessment engine — you set parameters only" },
];

export function FeeBuilder({
  serviceId,
  serviceName,
  initial,
  formFields,
  engineAvailable,
  onSaveState,
  onDesignPersisted,
}: Props) {
  const [design, setDesign] = useState(initial);
  const [amountRupees, setAmountRupees] = useState(paiseToRupeesInput(initial.baseAmountPaise));
  const [sampleValues, setSampleValues] = useState<Record<string, string>>({});
  const [sampleNumeric, setSampleNumeric] = useState("100");
  const [hoaOptions, setHoaOptions] = useState<{ code: string; label: string }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(design);
  latest.current = design;

  useEffect(() => {
    fetchHoaOptions().then(setHoaOptions).catch(() => setHoaOptions([]));
  }, []);

  const sampleFields = useMemo(
    () => buildSampleSubjectFields(design.exemptions, formFields),
    [design.exemptions, formFields],
  );

  const sampleSubject = useMemo(() => {
    const subject: Record<string, unknown> = {};
    for (const f of sampleFields) {
      const raw = sampleValues[f.id] ?? "";
      if (f.valueType === "number") subject[f.id] = raw === "" ? undefined : Number(raw);
      else if (f.valueType === "boolean") subject[f.id] = raw === "true";
      else subject[f.id] = raw;
    }
    return subject;
  }, [sampleFields, sampleValues]);

  const sampleCalc = useMemo(
    () => buildSampleCalculation(design, sampleSubject, Number(sampleNumeric) || 0),
    [design, sampleSubject, sampleNumeric],
  );

  const schedulePersist = useCallback(() => {
    if (!design.feeModel || design.feeModel === "engine") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      onSaveState?.("saving");
      try {
        const saved = await persistFeeDesign(latest.current, serviceId, serviceName);
        setDesign(saved);
        onDesignPersisted?.(saved);
        onSaveState?.("saved");
      } catch {
        onSaveState?.("offline");
      }
    }, 2000);
  }, [onDesignPersisted, onSaveState, serviceId, serviceName, design.feeModel]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { schedulePersist(); }, [design, schedulePersist]);

  const selectModel = (model: FeeModelUi) => {
    if (model === "engine" && !engineAvailable) return;
    setDesign((d) => ({ ...d, feeModel: model }));
  };

  const updateAmountRupees = (value: string) => {
    setAmountRupees(value);
    setDesign((d) => ({ ...d, baseAmountPaise: rupeesInputToPaise(value) }));
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr minmax(220px, 280px)", gap: 16, alignItems: "start" }}>
      <div style={{ display: "grid", gap: 16 }}>
        {(
          <Card>
            <div className="pad">
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Fee model</h3>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--mut)" }}>
                How is the fee calculated for this service?
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                {MODEL_CARDS.map((card) => {
                  const disabled = card.id === "engine" && !engineAvailable;
                  const selected = design.feeModel === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      className={`card${selected ? " is-selected" : ""}`}
                      disabled={disabled}
                      onClick={() => selectModel(card.id)}
                      style={{
                        textAlign: "left",
                        padding: 14,
                        cursor: disabled ? "not-allowed" : "pointer",
                        opacity: disabled ? 0.55 : 1,
                        border: selected ? "2px solid var(--info)" : "1px solid var(--line)",
                        background: "var(--surface)",
                      }}
                    >
                      <strong style={{ display: "block", marginBottom: 4 }}>{card.title}</strong>
                      <span style={{ fontSize: 13, color: "var(--mut)" }}>{card.description}</span>
                      {disabled ? (
                        <span style={{ display: "block", marginTop: 8, fontSize: 12, color: "var(--warn-fg)" }}>
                          No assessment engine is bound to this service yet.
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>
        )}

        {design.feeModel === "flat" ? (
          <Card>
            <div className="pad">
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Fixed amount</h3>
              <label style={{ display: "grid", gap: 4, maxWidth: 240, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>Amount (₹)</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={amountRupees}
                  onChange={(e) => updateAmountRupees(e.target.value)}
                />
              </label>
              <h4 style={{ margin: "20px 0 8px", fontSize: 14 }}>Exemptions</h4>
              <FeeExemptionBuilder
                exemptions={design.exemptions}
                formFields={formFields}
                onChange={(exemptions) => setDesign((d) => ({ ...d, exemptions }))}
              />
            </div>
          </Card>
        ) : null}

        {design.feeModel === "slab" ? (
          <Card>
            <div className="pad">
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Rate slabs</h3>
              <label style={{ display: "grid", gap: 4, maxWidth: 320, marginBottom: 12, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>Variable field (for sample)</span>
                <select
                  className="input"
                  value={design.slabVariable}
                  onChange={(e) => setDesign((d) => ({ ...d, slabVariable: e.target.value }))}
                >
                  <option value="">Select form field…</option>
                  {formFields.filter((f) => f.type === "number").map((f) => (
                    <option key={f.id} value={f.apiName}>{f.label || f.apiName}</option>
                  ))}
                </select>
              </label>
              <SlabTableEditor
                slabs={design.slabs}
                onChange={(slabs) => setDesign((d) => ({ ...d, slabs }))}
                sampleValue={sampleNumeric}
                onSampleValueChange={setSampleNumeric}
                previewAmountPaise={sampleCalc.totalPaise}
              />
            </div>
          </Card>
        ) : null}

        {design.feeModel === "engine" && engineAvailable ? (
          <Card>
            <div className="pad">
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Engine parameters</h3>
              <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
                Fee amounts are computed by the bound assessment engine. Configure exemptions and HOA below.
              </p>
            </div>
          </Card>
        ) : null}

        {design.feeModel ? (
          <Card>
            <div className="pad">
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Revenue mapping</h3>
              <label style={{ display: "grid", gap: 4, marginBottom: 12, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>Head of Account <span style={{ color: "var(--bad-fg)" }}>*</span></span>
                <select
                  className="input"
                  required
                  value={design.hoaCode}
                  onChange={(e) => setDesign((d) => ({ ...d, hoaCode: e.target.value }))}
                >
                  <option value="">Select HOA…</option>
                  {hoaOptions.map((h) => (
                    <option key={h.code} value={h.code}>{h.label}</option>
                  ))}
                </select>
                {!design.hoaCode ? (
                  <span style={{ color: "var(--warn-fg)", fontSize: 12 }}>
                    Required before submit — choose the account that receives this fee.
                  </span>
                ) : null}
              </label>
              <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
                <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>When is the demand raised?</legend>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 6 }}>
                  <input
                    type="radio"
                    name="demandTrigger"
                    checked={design.demandTrigger === "submission"}
                    onChange={() => setDesign((d) => ({ ...d, demandTrigger: "submission" }))}
                  />
                  On submission
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <input
                    type="radio"
                    name="demandTrigger"
                    checked={design.demandTrigger === "approval"}
                    onChange={() => setDesign((d) => ({ ...d, demandTrigger: "approval" }))}
                  />
                  On approval
                </label>
              </fieldset>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>Rebate window (days before due)</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={design.rebateDays}
                    onChange={(e) => setDesign((d) => ({ ...d, rebateDays: Number(e.target.value) || 0 }))}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>Penalty grace (days)</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={design.penaltyDays}
                    onChange={(e) => setDesign((d) => ({ ...d, penaltyDays: Number(e.target.value) || 0 }))}
                  />
                </label>
              </div>
            </div>
          </Card>
        ) : null}
      </div>

      <Card>
        <div className="pad">
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Sample calculation</h3>
          {!design.feeModel ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>Choose a fee model to preview amounts.</p>
          ) : (
            <>
              {design.feeModel === "flat" && sampleFields.length > 0 ? (
                <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                  {sampleFields.map((f) => (
                    <label key={f.id} style={{ display: "grid", gap: 4, fontSize: 12 }}>
                      <span>{f.label}</span>
                      <input
                        className="input"
                        type={f.valueType === "number" ? "number" : "text"}
                        value={sampleValues[f.id] ?? ""}
                        onChange={(e) => setSampleValues((v) => ({ ...v, [f.id]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
              ) : null}
              {design.feeModel === "slab" ? (
                <label style={{ display: "grid", gap: 4, marginBottom: 12, fontSize: 12 }}>
                  <span>{design.slabVariable || "Sample value"}</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={sampleNumeric}
                    onChange={(e) => setSampleNumeric(e.target.value)}
                  />
                </label>
              ) : null}
              <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 13 }}>
                {sampleCalc.lines.map((line) => (
                  <li
                    key={line.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "6px 0",
                      borderBottom: "1px solid var(--line)",
                    }}
                  >
                    <span>{line.label}</span>
                    <span>{formatMoney(line.amountPaise)}</span>
                  </li>
                ))}
              </ul>
              <p style={{ margin: "12px 0 0", fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
                <span>Total</span>
                <span>{formatMoney(sampleCalc.totalPaise)}</span>
              </p>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
