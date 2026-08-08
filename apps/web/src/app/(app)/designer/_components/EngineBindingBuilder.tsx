"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, EmptyState } from "@/app/_components/ds";
import {
  bpsToPercentInput,
  percentInputToBps,
  type EngineBindingUi,
  type EngineBlockUi,
  type EngineDescriptorUi,
  type EnginePreviewResultUi,
} from "@/app/_components/ds/designer/engineBindingTypes";
import { formatMoney } from "@/lib/formatters";
import {
  bindingFromDescriptor,
  fetchEngineRegistry,
  newExemptionRow,
  persistEngineBindings,
  previewEngineBinding,
} from "../_data/engineBindingApi";

interface Props {
  definitionId: string;
  initial: EngineBindingUi[];
  /** Prefer fee for Collection / PT; verification for police, etc. */
  defaultBlock?: EngineBlockUi;
  onSaveState?: (state: "saving" | "saved" | "offline") => void;
  onBindingsPersisted?: (bindings: EngineBindingUi[]) => void;
}

export function EngineBindingBuilder({
  definitionId,
  initial,
  defaultBlock = "fee",
  onSaveState,
  onBindingsPersisted,
}: Props) {
  const [bindings, setBindings] = useState<EngineBindingUi[]>(initial);
  const [registry, setRegistry] = useState<EngineDescriptorUi[]>([]);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [blockFilter, setBlockFilter] = useState<EngineBlockUi>(defaultBlock);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [sampleBaseRupees, setSampleBaseRupees] = useState("1000");
  const [selectedExemptions, setSelectedExemptions] = useState<string[]>([]);
  const [applyRebate, setApplyRebate] = useState(true);
  const [applyPenalty, setApplyPenalty] = useState(false);
  const [preview, setPreview] = useState<EnginePreviewResultUi | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(bindings);
  latest.current = bindings;

  useEffect(() => {
    let cancelled = false;
    fetchEngineRegistry()
      .then((data) => { if (!cancelled) { setRegistry(data); setRegistryError(null); } })
      .catch((e) => {
        if (!cancelled) setRegistryError(e instanceof Error ? e.message : "Could not load engines.");
      });
    return () => { cancelled = true; };
  }, []);

  const selected = bindings.find((b) => b.id === selectedId) ?? null;
  const selectedDescriptor = useMemo(
    () => (selected ? registry.find((e) => e.engineKey === selected.engineKey) : undefined),
    [registry, selected],
  );

  const enginesForFilter = useMemo(
    () => registry.filter((e) => e.blocks.includes(blockFilter)),
    [registry, blockFilter],
  );

  const schedulePersist = useCallback((next: EngineBindingUi[]) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      onSaveState?.("saving");
      try {
        await persistEngineBindings(definitionId, next, { setFeeModelEngine: true });
        onBindingsPersisted?.(next);
        onSaveState?.("saved");
      } catch {
        onSaveState?.("offline");
      }
    }, 2000);
  }, [definitionId, onBindingsPersisted, onSaveState]);

  const updateBindings = (next: EngineBindingUi[]) => {
    setBindings(next);
    schedulePersist(next);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (previewTimer.current) clearTimeout(previewTimer.current);
  }, []);

  // Live sample preview via engine API (Studio parameters only).
  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      const rupees = Number(sampleBaseRupees);
      const basePrincipalMinor = Number.isFinite(rupees) ? Math.round(rupees * 100) : 0;
      try {
        const result = await previewEngineBinding({
          binding: selected,
          basePrincipalMinor,
          selectedExemptions,
          applyRebate,
          applyPenalty,
        });
        setPreview(result);
        setPreviewError(null);
      } catch (e) {
        setPreview(null);
        setPreviewError(e instanceof Error ? e.message : "Preview failed.");
      }
    }, 300);
  }, [selected, sampleBaseRupees, selectedExemptions, applyRebate, applyPenalty]);

  const bindEngine = (eng: EngineDescriptorUi) => {
    if (!eng.available) return;
    const existing = bindings.find(
      (b) => b.block === blockFilter && b.engineKey === eng.engineKey,
    );
    if (existing) {
      setSelectedId(existing.id);
      return;
    }
    // One primary binding per block — replace prior fee/assessment binding.
    const withoutBlock = bindings.filter((b) => b.block !== blockFilter);
    const nextBinding = bindingFromDescriptor(eng, blockFilter);
    const next = [...withoutBlock, nextBinding];
    setSelectedId(nextBinding.id);
    updateBindings(next);
  };

  const removeSelected = () => {
    if (!selected) return;
    const next = bindings.filter((b) => b.id !== selected.id);
    setSelectedId(next[0]?.id ?? null);
    updateBindings(next);
  };

  const patchSelected = (patch: Partial<EngineBindingUi> | ((b: EngineBindingUi) => EngineBindingUi)) => {
    if (!selected) return;
    const next = bindings.map((b) => {
      if (b.id !== selected.id) return b;
      return typeof patch === "function" ? patch(b) : { ...b, ...patch };
    });
    updateBindings(next);
  };

  const patchConfig = (cfg: Partial<EngineBindingUi["config"]>) => {
    patchSelected((b) => ({ ...b, config: { ...b.config, ...cfg } }));
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr minmax(240px, 300px)", gap: 16, alignItems: "start" }}>
      <div style={{ display: "grid", gap: 16 }}>
        <Card>
          <div className="pad">
            <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Engine bindings</h3>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--mut)" }}>
              Link this service to an engineered backend. You configure parameters only —
              assessment and verification logic stay in the engine.
            </p>
            <label style={{ display: "grid", gap: 4, maxWidth: 280, fontSize: 13, marginBottom: 12 }}>
              <span style={{ fontWeight: 600 }}>Block</span>
              <select
                className="input"
                value={blockFilter}
                onChange={(e) => setBlockFilter(e.target.value as EngineBlockUi)}
              >
                <option value="fee">Fee</option>
                <option value="assessment">Assessment</option>
                <option value="verification">Verification</option>
                <option value="inspection">Inspection</option>
                <option value="numbering">Numbering</option>
              </select>
            </label>

            {registryError ? (
              <p style={{ color: "var(--bad-fg)", fontSize: 13 }}>{registryError}</p>
            ) : null}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {enginesForFilter.map((eng) => {
                const bound = bindings.some((b) => b.block === blockFilter && b.engineKey === eng.engineKey);
                const disabled = !eng.available;
                return (
                  <button
                    key={eng.engineKey}
                    type="button"
                    disabled={disabled}
                    onClick={() => bindEngine(eng)}
                    style={{
                      textAlign: "left",
                      padding: 14,
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.55 : 1,
                      border: bound ? "2px solid var(--info)" : "1px solid var(--line)",
                      background: "var(--surface)",
                      borderRadius: "var(--r-sm)",
                    }}
                  >
                    <strong style={{ display: "block", marginBottom: 4 }}>{eng.label}</strong>
                    <span style={{ fontSize: 13, color: "var(--mut)" }}>{eng.description}</span>
                    {disabled ? (
                      <span style={{ display: "block", marginTop: 8, fontSize: 12, color: "var(--warn-fg)" }}>
                        {eng.unavailableReason ?? "Engine not available in this environment."}
                      </span>
                    ) : null}
                    {bound ? (
                      <span style={{ display: "block", marginTop: 8, fontSize: 12, color: "var(--good-fg)" }}>
                        Bound
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        {bindings.length === 0 ? (
          <EmptyState
            icon="🔗"
            title="No engines bound"
            message="Choose an available engine above. For Property Tax, bind revenue.assessment — then edit exemptions and HOA."
          />
        ) : (
          <Card>
            <div className="pad">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>Parameters</h3>
                {selected ? (
                  <button type="button" className="btn ghost" onClick={removeSelected}>
                    Remove binding
                  </button>
                ) : null}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {bindings.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="btn ghost"
                    onClick={() => setSelectedId(b.id)}
                    style={{
                      borderColor: b.id === selectedId ? "var(--info)" : undefined,
                      fontWeight: b.id === selectedId ? 700 : 400,
                    }}
                  >
                    {b.block} · {b.engineKey}
                  </button>
                ))}
              </div>

              {!selected ? (
                <p style={{ margin: 0, color: "var(--mut)", fontSize: 13 }}>Select a binding to edit parameters.</p>
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
                  {!selectedDescriptor?.available ? (
                    <p style={{ margin: 0, fontSize: 13, color: "var(--warn-fg)" }}>
                      {selectedDescriptor?.unavailableReason
                        ?? "This engine is stubbed — sandbox test will fail until a live engine is bound."}
                    </p>
                  ) : null}

                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={selected.requiredForPublish}
                      onChange={(e) => patchSelected({ requiredForPublish: e.target.checked })}
                    />
                    Required for publish / sandbox
                  </label>

                  {(selected.block === "fee" || selected.block === "assessment") ? (
                    <>
                      <label style={{ display: "grid", gap: 4, fontSize: 13, maxWidth: 320 }}>
                        <span style={{ fontWeight: 600 }}>
                          Head of Account <span style={{ color: "var(--bad-fg)" }}>*</span>
                        </span>
                        <input
                          className="input"
                          value={selected.config.hoaCode}
                          onChange={(e) => patchConfig({ hoaCode: e.target.value })}
                          placeholder="e.g. 4201"
                        />
                      </label>

                      <div>
                        <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Exemption categories</h4>
                        <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--mut)" }}>
                          Exposed to applicants; changing a category updates the sample preview via the engine API.
                        </p>
                        <div style={{ display: "grid", gap: 8 }}>
                          {selected.config.exemptionCategories.map((cat, idx) => (
                            <div
                              key={`${cat.code}-${idx}`}
                              style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 100px auto", gap: 8 }}
                            >
                              <input
                                className="input"
                                aria-label="Exemption code"
                                placeholder="Code"
                                value={cat.code}
                                onChange={(e) => {
                                  const exemptionCategories = selected.config.exemptionCategories.map((c, i) =>
                                    i === idx ? { ...c, code: e.target.value.toUpperCase() } : c,
                                  );
                                  patchConfig({ exemptionCategories });
                                }}
                              />
                              <input
                                className="input"
                                aria-label="Exemption label"
                                placeholder="Label"
                                value={cat.label}
                                onChange={(e) => {
                                  const exemptionCategories = selected.config.exemptionCategories.map((c, i) =>
                                    i === idx ? { ...c, label: e.target.value } : c,
                                  );
                                  patchConfig({ exemptionCategories });
                                }}
                              />
                              <input
                                className="input"
                                aria-label="Exemption percent"
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                value={bpsToPercentInput(cat.percentBps)}
                                onChange={(e) => {
                                  const exemptionCategories = selected.config.exemptionCategories.map((c, i) =>
                                    i === idx ? { ...c, percentBps: percentInputToBps(e.target.value) } : c,
                                  );
                                  patchConfig({ exemptionCategories });
                                }}
                              />
                              <button
                                type="button"
                                className="btn ghost"
                                onClick={() => {
                                  const exemptionCategories = selected.config.exemptionCategories.filter((_, i) => i !== idx);
                                  patchConfig({ exemptionCategories });
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="btn ghost"
                          style={{ marginTop: 8 }}
                          onClick={() => patchConfig({
                            exemptionCategories: [...selected.config.exemptionCategories, newExemptionRow()],
                          })}
                        >
                          Add exemption category
                        </button>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                          <span style={{ fontWeight: 600 }}>Rebate (%)</span>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            value={bpsToPercentInput(selected.config.rebatePercentBps)}
                            onChange={(e) => patchConfig({ rebatePercentBps: percentInputToBps(e.target.value) })}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                          <span style={{ fontWeight: 600 }}>Rebate window (days)</span>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            value={selected.config.rebateWindowDays}
                            onChange={(e) => patchConfig({ rebateWindowDays: Number(e.target.value) || 0 })}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                          <span style={{ fontWeight: 600 }}>Penalty (%)</span>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            value={bpsToPercentInput(selected.config.penaltyPercentBps)}
                            onChange={(e) => patchConfig({ penaltyPercentBps: percentInputToBps(e.target.value) })}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                          <span style={{ fontWeight: 600 }}>Penalty grace (days)</span>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            value={selected.config.penaltyGraceDays}
                            onChange={(e) => patchConfig({ penaltyGraceDays: Number(e.target.value) || 0 })}
                          />
                        </label>
                      </div>
                    </>
                  ) : (
                    <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
                      Parameter form for this block is limited in v1 — binding records the engine key for runtime hooks.
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      <Card>
        <div className="pad">
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Sample calculation</h3>
          {!selected || (selected.block !== "fee" && selected.block !== "assessment") ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
              Bind a fee or assessment engine to preview demand lines.
            </p>
          ) : (
            <>
              <label style={{ display: "grid", gap: 4, marginBottom: 10, fontSize: 12 }}>
                <span>Engine principal sample (₹)</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={sampleBaseRupees}
                  onChange={(e) => setSampleBaseRupees(e.target.value)}
                />
              </label>
              {selected.config.exemptionCategories.length > 0 ? (
                <fieldset style={{ border: "none", margin: "0 0 10px", padding: 0 }}>
                  <legend style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Apply exemptions</legend>
                  {selected.config.exemptionCategories.map((cat) => (
                    <label
                      key={cat.code || cat.label}
                      style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, marginBottom: 4 }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedExemptions.includes(cat.code)}
                        disabled={!cat.code}
                        onChange={(e) => {
                          setSelectedExemptions((prev) =>
                            e.target.checked
                              ? [...prev, cat.code]
                              : prev.filter((c) => c !== cat.code),
                          );
                        }}
                      />
                      {cat.label || cat.code} ({bpsToPercentInput(cat.percentBps)}%)
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, marginBottom: 4 }}>
                <input type="checkbox" checked={applyRebate} onChange={(e) => setApplyRebate(e.target.checked)} />
                Apply early rebate
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, marginBottom: 12 }}>
                <input type="checkbox" checked={applyPenalty} onChange={(e) => setApplyPenalty(e.target.checked)} />
                Apply penalty
              </label>
              {previewError ? (
                <p style={{ margin: 0, fontSize: 12, color: "var(--bad-fg)" }}>{previewError}</p>
              ) : null}
              {preview && !preview.available ? (
                <p style={{ margin: 0, fontSize: 12, color: "var(--warn-fg)" }}>{preview.note}</p>
              ) : null}
              {preview?.available ? (
                <>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 13 }}>
                    {preview.lines.map((line) => (
                      <li
                        key={`${line.taxHeadCode}-${line.label}`}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          padding: "6px 0",
                          borderBottom: "1px solid var(--line)",
                        }}
                      >
                        <span>{line.label}</span>
                        <span>{formatMoney(line.amountMinor)}</span>
                      </li>
                    ))}
                  </ul>
                  <p style={{ margin: "12px 0 0", fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
                    <span>Total</span>
                    <span>{formatMoney(preview.totalMinor)}</span>
                  </p>
                  <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--mut)" }}>{preview.note}</p>
                </>
              ) : null}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
