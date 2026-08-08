"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Tabs } from "@/app/_components/ds";
import {
  NumberingFormatBuilder,
  TemplateCanvas,
  type IssuanceDesignState,
} from "@/app/_components/ds/designer";
import type { FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";
import { OUTPUT_TYPE_OPTIONS } from "@/app/_components/ds/designer/issuanceTypes";
import { fetchTenantPositions, requestSamplePdf } from "../_data/issuanceBuilderApi";
import {
  applyOutputTypeChange,
  mergeFieldsForDesign,
  numberingWarning,
  renewalGuidance,
  signatoryWarning,
  tabLabelForOutputType,
  validitySummary,
} from "../_data/issuanceBuilderModel";

interface Props {
  serviceName: string;
  pattern?: string;
  formFields?: FormFieldDefinition[];
  initial: IssuanceDesignState;
  onSaveState?: (state: "saving" | "saved" | "offline") => void;
  onDesignPersisted?: (design: IssuanceDesignState) => void;
  onDesignChange?: (design: IssuanceDesignState) => void;
}

export function OutputIssuanceBuilder({
  serviceName,
  pattern = "certificate",
  formFields = [],
  initial,
  onSaveState,
  onDesignPersisted,
  onDesignChange,
}: Props) {
  const [design, setDesign] = useState(initial);
  const [tab, setTab] = useState(tabLabelForOutputType(initial.outputType));
  const [positions, setPositions] = useState<{ id: string; label: string }[]>([]);
  const [samplePreview, setSamplePreview] = useState<string | null>(null);
  const [sampleBanner, setSampleBanner] = useState<string | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(design);
  latest.current = design;

  useEffect(() => {
    fetchTenantPositions().then(setPositions).catch(() => setPositions([]));
  }, []);

  useEffect(() => {
    onDesignChange?.(initial);
  }, [initial, onDesignChange]);

  const patch = useCallback(
    (p: Partial<IssuanceDesignState> | ((d: IssuanceDesignState) => IssuanceDesignState)) => {
      setDesign((prev) => {
        const next = typeof p === "function" ? p(prev) : { ...prev, ...p };
        onDesignChange?.(next);
        return next;
      });
    },
    [onDesignChange],
  );

  const schedulePersist = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      onSaveState?.("saving");
      try {
        onDesignPersisted?.(latest.current);
        onSaveState?.("saved");
      } catch {
        onSaveState?.("offline");
      }
    }, 2000);
  }, [onDesignPersisted, onSaveState]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { schedulePersist(); }, [design, schedulePersist]);

  const mergeFields = useMemo(
    () => mergeFieldsForDesign(formFields, design.outputType),
    [formFields, design.outputType],
  );

  const numWarn = numberingWarning(design.numberingTokens);
  const sigWarn = signatoryWarning(design);
  const renewNote = renewalGuidance(design);
  const validityNote = validitySummary(design);

  const primaryTab = tabLabelForOutputType(design.outputType);
  const tabs = useMemo(
    () => [primaryTab, "Numbering", "Signatory", "Validity"],
    [primaryTab],
  );

  useEffect(() => {
    setTab((current) => {
      const primaryTabs = ["Certificate", "Closure note", "Licence", "Receipt"];
      if (primaryTabs.includes(current) && current !== primaryTab) return primaryTab;
      return current;
    });
  }, [primaryTab]);

  const onOutputTypeChange = (outputType: IssuanceDesignState["outputType"]) => {
    patch((d) => applyOutputTypeChange(d, outputType));
    setTab(tabLabelForOutputType(outputType));
    setSamplePreview(null);
    setSampleBanner(null);
  };

  const generateSample = async () => {
    setSampleBusy(true);
    setSampleBanner(null);
    try {
      const result = await requestSamplePdf(design, serviceName, formFields);
      setSamplePreview(result.mergedText);
      setSampleBanner(result.banner);
      setTab(primaryTab);
    } finally {
      setSampleBusy(false);
    }
  };

  const isGrievance = pattern === "grievance";

  return (
    <div>
      {isGrievance ? (
        <p
          data-testid="grievance-closure-hint"
          style={{
            margin: "0 0 12px",
            padding: "10px 12px",
            borderRadius: "var(--r-sm)",
            border: "1px solid var(--line)",
            background: "var(--bg)",
            fontSize: 13,
            color: "var(--mut)",
          }}
        >
          Grievance services default to a <strong>Closure note</strong> — a resolution summary, not a certificate.
          You can still switch output type if your office needs a formal letter.
        </p>
      ) : null}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === primaryTab ? (
        <Card title={`${primaryTab} template`}>
          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>Output type</span>
            <select
              aria-label="Output type"
              data-testid="output-type"
              value={design.outputType}
              onChange={(e) => onOutputTypeChange(e.target.value as IssuanceDesignState["outputType"])}
              style={{ width: "100%", maxWidth: 360 }}
            >
              {OUTPUT_TYPE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} — {o.hint}
                </option>
              ))}
            </select>
          </label>
          <TemplateCanvas
            body={design.templateBody}
            onChange={(templateBody) => patch({ templateBody })}
            mergeFields={mergeFields}
            orientation={design.orientation}
            onOrientationChange={(orientation) => patch({ orientation })}
            outputType={design.outputType}
            signatoryLabel={design.signatoryLabel}
            qrVerifyEnabled={design.qrVerifyEnabled}
            onQrVerifyChange={(qrVerifyEnabled) => patch({ qrVerifyEnabled })}
            samplePreviewText={samplePreview}
            samplePreviewBanner={sampleBanner}
          />
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn ghost"
              data-testid="generate-sample-pdf"
              disabled={sampleBusy}
              onClick={() => void generateSample()}
            >
              {sampleBusy ? "Generating…" : "Generate sample PDF"}
            </button>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              Uses the real issuance pipeline when available; otherwise an honest sandbox preview.
            </span>
          </div>
        </Card>
      ) : null}

      {tab === "Numbering" ? (
        <Card title="Numbering">
          <NumberingFormatBuilder
            tokens={design.numberingTokens}
            onChange={(numberingTokens) => patch({ numberingTokens })}
            warning={numWarn}
          />
        </Card>
      ) : null}

      {tab === "Signatory" ? (
        <Card title="Signatory">
          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>Who signs / closes?</span>
            <select
              aria-label="Signatory designation"
              data-testid="signatory-select"
              value={design.signatoryDesignationId}
              onChange={(e) => {
                const pos = positions.find((p) => p.id === e.target.value);
                patch({
                  signatoryDesignationId: e.target.value,
                  signatoryLabel: pos?.label ?? "",
                });
              }}
              style={{ width: "100%", maxWidth: 400 }}
            >
              <option value="">— select designation —</option>
              {positions.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
          {positions.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--mut)", marginTop: 0 }}>
              No tenant positions loaded — you can still type a label below for the template preview.
            </p>
          ) : null}
          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>Signatory label on document</span>
            <input
              aria-label="Signatory label"
              data-testid="signatory-label"
              value={design.signatoryLabel}
              onChange={(e) => patch({ signatoryLabel: e.target.value })}
              placeholder="e.g. Licensing Officer"
              style={{ width: "100%", maxWidth: 400 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={design.digitalSignature}
              onChange={(e) => patch({ digitalSignature: e.target.checked })}
            />
            Require digital signature at issue time
          </label>
          {sigWarn ? (
            <p data-testid="signatory-warning" style={{ marginTop: 12, fontSize: 13, color: "var(--warn-fg)" }}>
              {sigWarn}
            </p>
          ) : null}
        </Card>
      ) : null}

      {tab === "Validity" ? (
        <Card title="Validity & renewal">
          {design.outputType === "closure_note" ? (
            <p data-testid="closure-validity-note" style={{ fontSize: 13, color: "var(--mut)", marginTop: 0 }}>
              Closure notes do not carry an expiry. Validity and renewal stay off for grievance-style outputs.
            </p>
          ) : (
            <>
              <fieldset style={{ border: "none", padding: 0, margin: "0 0 12px" }}>
                <legend style={{ fontSize: 12, color: "var(--mut)", marginBottom: 8 }}>Valid for</legend>
                {(["duration", "fixed_date", "none"] as const).map((mode) => (
                  <label key={mode} style={{ display: "block", marginBottom: 6 }}>
                    <input
                      type="radio"
                      name="validity"
                      checked={design.validityMode === mode}
                      onChange={() => patch({ validityMode: mode })}
                    />
                    {" "}
                    {mode === "duration"
                      ? "Fixed duration"
                      : mode === "fixed_date"
                        ? "Until a fixed date"
                        : "No expiry"}
                  </label>
                ))}
              </fieldset>
              {design.validityMode === "duration" ? (
                <label style={{ display: "block", marginBottom: 12 }}>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>Years</span>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    aria-label="Validity years"
                    value={design.validityYears}
                    onChange={(e) => patch({ validityYears: Number(e.target.value) || 1 })}
                  />
                </label>
              ) : null}
              {design.validityMode === "fixed_date" ? (
                <label style={{ display: "block", marginBottom: 12 }}>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>Valid until</span>
                  <input
                    type="date"
                    aria-label="Valid until date"
                    value={design.validityFixedDate}
                    onChange={(e) => patch({ validityFixedDate: e.target.value })}
                  />
                </label>
              ) : null}
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <input
                  type="checkbox"
                  data-testid="renewable-toggle"
                  checked={design.renewable}
                  onChange={(e) => patch({ renewable: e.target.checked })}
                />
                Renewable
              </label>
              {design.renewable ? (
                <label style={{ display: "block", marginBottom: 12 }}>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>Renewal window (days before expiry)</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    aria-label="Renewal window days"
                    data-testid="renewal-window-days"
                    value={design.renewalWindowDays}
                    onChange={(e) => patch({ renewalWindowDays: Number(e.target.value) || 30 })}
                  />
                </label>
              ) : null}
            </>
          )}
          <p data-testid="validity-summary" style={{ fontSize: 13, marginBottom: 0 }}>
            {validityNote}
          </p>
          {renewNote ? (
            <p data-testid="renewal-guidance" style={{ fontSize: 13, color: "var(--mut)", marginTop: 8 }}>
              {renewNote}
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
