"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/app/_components/ds";
import {
  FeeExemptionBuilder,
  SlabTableEditor,
  type FormFieldDefinition,
  type SamplePaymentScenario,
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
import {
  FEE_MODEL_CARDS,
  filterHoaOptions,
  hoaBlockMessage,
  isHoaBlocking,
  modelCardDisabled,
  suggestExemptSampleValues,
  suggestFullFeeSampleValues,
} from "../_data/feeBuilderModel";

interface Props {
  serviceId: string;
  serviceName: string;
  initial: FeeDesignState;
  formFields: FormFieldDefinition[];
  engineAvailable: boolean;
  onSaveState?: (state: "saving" | "saved" | "offline") => void;
  onDesignPersisted?: (design: FeeDesignState) => void;
  /** Fired whenever local design changes (for Next / submit gating). */
  onDesignChange?: (design: FeeDesignState) => void;
}

const ENGINE_PARAM_KEYS = [
  { key: "unitArea", label: "Unit area (sq. m)" },
  { key: "occupancyCategory", label: "Occupancy category" },
  { key: "assessmentYear", label: "Assessment year" },
] as const;

const SCENARIOS: { id: SamplePaymentScenario; label: string }[] = [
  { id: "on_time", label: "On time" },
  { id: "early", label: "Pay early" },
  { id: "late", label: "Pay late" },
];

function lineColor(kind: string | undefined, amountPaise: number): string | undefined {
  if (kind === "exemption" || kind === "rebate" || amountPaise < 0) return "var(--good-fg)";
  if (kind === "penalty") return "var(--bad-fg)";
  if (kind === "info") return "var(--mut)";
  return undefined;
}

export function FeeBuilder({
  serviceId,
  serviceName,
  initial,
  formFields,
  engineAvailable,
  onSaveState,
  onDesignPersisted,
  onDesignChange,
}: Props) {
  const [design, setDesign] = useState(initial);
  const [amountRupees, setAmountRupees] = useState(paiseToRupeesInput(initial.baseAmountPaise));
  const [sampleValues, setSampleValues] = useState<Record<string, string>>({});
  const [sampleNumeric, setSampleNumeric] = useState("100");
  const [scenario, setScenario] = useState<SamplePaymentScenario>("on_time");
  const [hoaOptions, setHoaOptions] = useState<{ code: string; label: string }[]>([]);
  const [hoaQuery, setHoaQuery] = useState("");
  const [hoaListOpen, setHoaListOpen] = useState(false);
  const [showFormula, setShowFormula] = useState(Boolean(initial.formula));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(design);
  latest.current = design;

  const patchDesign = useCallback((updater: (d: FeeDesignState) => FeeDesignState) => {
    setDesign((prev) => {
      const next = updater(prev);
      onDesignChange?.(next);
      return next;
    });
  }, [onDesignChange]);

  useEffect(() => {
    onDesignChange?.(initial);
  }, [initial, onDesignChange]);

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
    () => buildSampleCalculation(design, sampleSubject, Number(sampleNumeric) || 0, scenario),
    [design, sampleSubject, sampleNumeric, scenario],
  );

  const filteredHoa = useMemo(
    () => filterHoaOptions(hoaOptions, hoaQuery),
    [hoaOptions, hoaQuery],
  );

  const hoaBlocking = isHoaBlocking(design);
  const hoaMessage = hoaBlockMessage(design);
  const selectedHoaLabel = hoaOptions.find((h) => h.code === design.hoaCode)?.label
    ?? (design.hoaCode ? design.hoaCode : "");

  const schedulePersist = useCallback(() => {
    if (!design.feeModel || design.feeModel === "engine") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      onSaveState?.("saving");
      try {
        const saved = await persistFeeDesign(latest.current, serviceId, serviceName);
        setDesign(saved);
        onDesignPersisted?.(saved);
        onDesignChange?.(saved);
        onSaveState?.("saved");
      } catch {
        onSaveState?.("offline");
      }
    }, 2000);
  }, [onDesignChange, onDesignPersisted, onSaveState, serviceId, serviceName, design.feeModel]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { schedulePersist(); }, [design, schedulePersist]);

  const selectModel = (model: FeeModelUi) => {
    if (modelCardDisabled(model, engineAvailable)) return;
    patchDesign((d) => ({ ...d, feeModel: model }));
  };

  const updateAmountRupees = (value: string) => {
    setAmountRupees(value);
    patchDesign((d) => ({ ...d, baseAmountPaise: rupeesInputToPaise(value) }));
  };

  const selectHoa = (code: string) => {
    patchDesign((d) => ({ ...d, hoaCode: code }));
    setHoaQuery("");
    setHoaListOpen(false);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr minmax(240px, 300px)", gap: 16, alignItems: "start" }}>
      <div style={{ display: "grid", gap: 16 }}>
        <nav aria-label="Fee builder steps" style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
          {[
            { n: 1, label: "Fee model", done: Boolean(design.feeModel) },
            { n: 2, label: "Configure", done: Boolean(design.feeModel) && (design.feeModel !== "flat" || design.baseAmountPaise > 0) },
            { n: 3, label: "Revenue & HOA", done: Boolean(design.feeModel) && !hoaBlocking },
          ].map((s) => (
            <span
              key={s.n}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid var(--line)",
                background: s.done ? "var(--good-bg, #e8f5e9)" : "var(--panel)",
                color: s.done ? "var(--good-fg)" : "var(--mut)",
                fontWeight: 600,
              }}
            >
              {s.n}. {s.label}
            </span>
          ))}
        </nav>

        <Card>
          <div className="pad">
            <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>1 · Fee model</h3>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--mut)" }}>
              How is the fee calculated for this service? Stored as an explicit fee model on the pack.
            </p>
            <div
              role="radiogroup"
              aria-label="Fee model"
              style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}
            >
              {FEE_MODEL_CARDS.map((card) => {
                const disabled = modelCardDisabled(card.id, engineAvailable);
                const selected = design.feeModel === card.id;
                return (
                  <button
                    key={card.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={disabled}
                    onClick={() => selectModel(card.id)}
                    style={{
                      textAlign: "left",
                      padding: 14,
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.55 : 1,
                      border: selected ? "2px solid var(--info)" : "1px solid var(--line)",
                      background: selected ? "var(--panel)" : "var(--surface)",
                      borderRadius: "var(--r-sm)",
                    }}
                  >
                    <strong style={{ display: "block", marginBottom: 4 }}>{card.title}</strong>
                    <span style={{ fontSize: 13, color: "var(--mut)" }}>{card.description}</span>
                    {selected ? (
                      <span style={{ display: "block", marginTop: 8, fontSize: 12, color: "var(--info)" }}>
                        {card.stepHint}
                      </span>
                    ) : null}
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

        {design.feeModel === "flat" ? (
          <Card>
            <div className="pad">
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>2 · Fixed amount</h3>
              <label style={{ display: "grid", gap: 4, maxWidth: 240, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>Amount (₹)</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={amountRupees}
                  onChange={(e) => updateAmountRupees(e.target.value)}
                  aria-describedby="fee-amount-hint"
                />
                <span id="fee-amount-hint" style={{ color: "var(--mut)", fontSize: 12 }}>
                  Stored in paise — e.g. 500.00 → ₹500.00
                </span>
              </label>
              <h4 style={{ margin: "20px 0 8px", fontSize: 14 }}>Exemptions</h4>
              <FeeExemptionBuilder
                exemptions={design.exemptions}
                formFields={formFields}
                onChange={(exemptions) => patchDesign((d) => ({ ...d, exemptions }))}
              />
            </div>
          </Card>
        ) : null}

        {design.feeModel === "slab" ? (
          <Card>
            <div className="pad">
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>2 · Rate slabs</h3>
              <label style={{ display: "grid", gap: 4, maxWidth: 320, marginBottom: 12, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>Variable field (for sample)</span>
                <select
                  className="input"
                  value={design.slabVariable}
                  onChange={(e) => patchDesign((d) => ({ ...d, slabVariable: e.target.value }))}
                >
                  <option value="">Select form field…</option>
                  {formFields.filter((f) => f.type === "number").map((f) => (
                    <option key={f.id} value={f.apiName}>{f.label || f.apiName}</option>
                  ))}
                </select>
              </label>
              <SlabTableEditor
                slabs={design.slabs}
                onChange={(slabs) => patchDesign((d) => ({ ...d, slabs }))}
                sampleValue={sampleNumeric}
                onSampleValueChange={setSampleNumeric}
                previewAmountPaise={sampleCalc.totalPaise}
              />
              <div style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setShowFormula((v) => !v)}
                  aria-expanded={showFormula}
                >
                  {showFormula ? "Hide advanced formula" : "Advanced: formula"}
                </button>
                {showFormula ? (
                  <label style={{ display: "grid", gap: 4, marginTop: 10, fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>Formula</span>
                    <textarea
                      className="input"
                      rows={3}
                      value={design.formula ?? ""}
                      onChange={(e) => patchDesign((d) => ({ ...d, formula: e.target.value }))}
                      placeholder="e.g. base + (area * rate) — evaluated by metadata formula at runtime"
                      spellCheck={false}
                    />
                    <span style={{ color: "var(--mut)", fontSize: 12 }}>
                      Optional. Slabs remain the guided path; formula is for advanced packs.
                    </span>
                  </label>
                ) : null}
              </div>
            </div>
          </Card>
        ) : null}

        {design.feeModel === "engine" && engineAvailable ? (
          <Card>
            <div className="pad">
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>2 · Engine parameters</h3>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--mut)" }}>
                Amounts are computed by the bound assessment engine. Set parameters your pack exposes.
              </p>
              <div style={{ display: "grid", gap: 10, maxWidth: 360 }}>
                {ENGINE_PARAM_KEYS.map((p) => (
                  <label key={p.key} style={{ display: "grid", gap: 4, fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>{p.label}</span>
                    <input
                      className="input"
                      value={design.engineParams[p.key] ?? ""}
                      onChange={(e) =>
                        patchDesign((d) => ({
                          ...d,
                          engineParams: { ...d.engineParams, [p.key]: e.target.value },
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          </Card>
        ) : null}

        {design.feeModel ? (
          <Card>
            <div className="pad">
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>3 · Revenue mapping</h3>

              {hoaBlocking ? (
                <div
                  role="alert"
                  data-testid="hoa-blocking-banner"
                  style={{
                    marginBottom: 12,
                    padding: "10px 12px",
                    borderRadius: "var(--r-sm)",
                    border: "1px solid var(--bad-fg)",
                    background: "var(--bad-bg, #fdecea)",
                    color: "var(--bad-fg)",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {hoaMessage}
                </div>
              ) : null}

              <label style={{ display: "grid", gap: 4, marginBottom: 12, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>
                  Head of Account <span style={{ color: "var(--bad-fg)" }}>*</span>
                </span>
                <div style={{ position: "relative" }}>
                  <input
                    className="input"
                    id="hoa-search"
                    role="combobox"
                    aria-label="Head of Account"
                    aria-expanded={hoaListOpen}
                    aria-controls="hoa-options-list"
                    aria-autocomplete="list"
                    aria-required
                    aria-invalid={hoaBlocking}
                    placeholder="Search by code or description…"
                    value={hoaListOpen || hoaQuery ? hoaQuery : selectedHoaLabel}
                    onChange={(e) => {
                      setHoaQuery(e.target.value);
                      setHoaListOpen(true);
                      if (design.hoaCode) patchDesign((d) => ({ ...d, hoaCode: "" }));
                    }}
                    onFocus={() => {
                      setHoaListOpen(true);
                      setHoaQuery("");
                    }}
                    onBlur={() => {
                      // defer so option click registers
                      setTimeout(() => setHoaListOpen(false), 150);
                    }}
                  />
                  {hoaListOpen ? (
                    <ul
                      id="hoa-options-list"
                      role="listbox"
                      style={{
                        position: "absolute",
                        zIndex: 20,
                        left: 0,
                        right: 0,
                        margin: 0,
                        padding: 0,
                        listStyle: "none",
                        maxHeight: 220,
                        overflowY: "auto",
                        background: "var(--surface)",
                        border: "1px solid var(--line)",
                        borderRadius: "var(--r-sm)",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                      }}
                    >
                      {filteredHoa.length === 0 ? (
                        <li style={{ padding: 10, fontSize: 13, color: "var(--mut)" }}>
                          {hoaOptions.length === 0
                            ? "No HOA codes loaded — check finance major-heads access."
                            : "No matches."}
                        </li>
                      ) : (
                        filteredHoa.map((h) => (
                          <li key={h.code} role="option" aria-selected={design.hoaCode === h.code}>
                            <button
                              type="button"
                              className="btn ghost"
                              style={{
                                width: "100%",
                                justifyContent: "flex-start",
                                textAlign: "left",
                                borderRadius: 0,
                                fontWeight: design.hoaCode === h.code ? 700 : 400,
                              }}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => selectHoa(h.code)}
                            >
                              {h.label}
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  ) : null}
                </div>
                {design.hoaCode ? (
                  <span style={{ color: "var(--good-fg)", fontSize: 12 }}>
                    Attached: {design.hoaCode}
                  </span>
                ) : (
                  <span style={{ color: "var(--warn-fg)", fontSize: 12 }}>
                    Required before Next / Submit — choose the account that receives this fee.
                  </span>
                )}
              </label>

              <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
                <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>When is the demand raised?</legend>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 6 }}>
                  <input
                    type="radio"
                    name="demandTrigger"
                    checked={design.demandTrigger === "submission"}
                    onChange={() => patchDesign((d) => ({ ...d, demandTrigger: "submission" }))}
                  />
                  On submission
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <input
                    type="radio"
                    name="demandTrigger"
                    checked={design.demandTrigger === "approval"}
                    onChange={() => patchDesign((d) => ({ ...d, demandTrigger: "approval" }))}
                  />
                  On approval
                </label>
              </fieldset>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>Rebate window (days)</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={design.rebateDays}
                    onChange={(e) => patchDesign((d) => ({ ...d, rebateDays: Number(e.target.value) || 0 }))}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>Rebate %</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    value={design.rebatePercent}
                    onChange={(e) => patchDesign((d) => ({ ...d, rebatePercent: Number(e.target.value) || 0 }))}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>Penalty grace (days)</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={design.penaltyDays}
                    onChange={(e) => patchDesign((d) => ({ ...d, penaltyDays: Number(e.target.value) || 0 }))}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>Penalty %</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    value={design.penaltyPercent}
                    onChange={(e) => patchDesign((d) => ({ ...d, penaltyPercent: Number(e.target.value) || 0 }))}
                  />
                </label>
              </div>
            </div>
          </Card>
        ) : null}
      </div>

      <aside aria-label="Sample calculation" style={{ position: "sticky", top: 16 }}>
        <Card>
          <div className="pad">
            <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Sample calculation</h3>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--mut)" }}>
              Demand lines as the applicant will see them (base / rebate / penalty / total).
            </p>
            {!design.feeModel ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>Choose a fee model to preview amounts.</p>
            ) : (
              <>
                {design.feeModel === "flat" ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setSampleValues(suggestFullFeeSampleValues(design.exemptions, formFields))}
                    >
                      Full fee
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setSampleValues(suggestExemptSampleValues(design.exemptions))}
                      disabled={design.exemptions.length === 0}
                      title={design.exemptions.length === 0 ? "Add an exemption first" : undefined}
                    >
                      Exempt sample
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setSampleValues({})}
                    >
                      Clear
                    </button>
                  </div>
                ) : null}

                {design.feeModel === "flat" && sampleFields.length > 0 ? (
                  <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                    {sampleFields.map((f) => (
                      <label key={f.id} style={{ display: "grid", gap: 4, fontSize: 12 }}>
                        <span>{f.label}</span>
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

                <fieldset style={{ border: "none", margin: "0 0 12px", padding: 0 }}>
                  <legend style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Payment timing</legend>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {SCENARIOS.map((s) => (
                      <label
                        key={s.id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 12,
                          padding: "4px 8px",
                          borderRadius: 999,
                          border: scenario === s.id ? "1px solid var(--info)" : "1px solid var(--line)",
                          background: scenario === s.id ? "var(--panel)" : "transparent",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="radio"
                          name="sampleScenario"
                          checked={scenario === s.id}
                          onChange={() => setScenario(s.id)}
                          style={{ margin: 0 }}
                        />
                        {s.label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <ul
                  data-testid="sample-demand-lines"
                  style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 13 }}
                >
                  {sampleCalc.lines.map((line) => (
                    <li
                      key={`${line.taxHeadCode ?? line.label}-${line.label}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        padding: "6px 0",
                        borderBottom: "1px solid var(--line)",
                        color: lineColor(line.kind, line.amountPaise),
                      }}
                    >
                      <span>
                        {line.label}
                        {line.taxHeadCode ? (
                          <span style={{ display: "block", fontSize: 11, color: "var(--mut)" }}>
                            {line.taxHeadCode}
                          </span>
                        ) : null}
                      </span>
                      <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                        {formatMoney(line.amountPaise)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p
                  style={{
                    margin: "12px 0 0",
                    fontWeight: 700,
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 14,
                  }}
                >
                  <span>Total</span>
                  <span data-testid="sample-total">{formatMoney(sampleCalc.totalPaise)}</span>
                </p>
                <p style={{ margin: "8px 0 0", fontSize: 12, color: hoaBlocking ? "var(--warn-fg)" : "var(--mut)" }}>
                  HOA: {design.hoaCode || "not attached"}
                </p>
              </>
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}
