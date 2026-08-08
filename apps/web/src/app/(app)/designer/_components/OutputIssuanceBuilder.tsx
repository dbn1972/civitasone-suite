"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, Tabs } from "@/app/_components/ds";
import {
  NumberingFormatBuilder,
  TemplateCanvas,
  type IssuanceDesignState,
} from "@/app/_components/ds/designer";
import { OUTPUT_TYPE_OPTIONS } from "@/app/_components/ds/designer/issuanceTypes";
import { fetchTenantPositions, requestSamplePdf } from "../_data/issuanceBuilderApi";

interface Props {
  serviceName: string;
  initial: IssuanceDesignState;
  onSaveState?: (state: "saving" | "saved" | "offline") => void;
  onDesignPersisted?: (design: IssuanceDesignState) => void;
}

export function OutputIssuanceBuilder({
  serviceName,
  initial,
  onSaveState,
  onDesignPersisted,
}: Props) {
  const [design, setDesign] = useState(initial);
  const [tab, setTab] = useState("Certificate");
  const [positions, setPositions] = useState<{ id: string; label: string }[]>([]);
  const [sampleMsg, setSampleMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(design);
  latest.current = design;

  useEffect(() => {
    fetchTenantPositions().then(setPositions).catch(() => setPositions([]));
  }, []);

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

  const patch = (p: Partial<IssuanceDesignState>) => setDesign((d) => ({ ...d, ...p }));

  const generateSample = async () => {
    setSampleMsg(null);
    const result = await requestSamplePdf(design, serviceName);
    setSampleMsg(result.message);
  };

  return (
    <div>
      <Tabs
        tabs={["Certificate", "Numbering", "Signatory", "Validity"]}
        active={tab}
        onChange={setTab}
      />

      {tab === "Certificate" ? (
        <Card title="Certificate template">
          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>Output type</span>
            <select
              value={design.outputType}
              onChange={(e) => patch({ outputType: e.target.value as IssuanceDesignState["outputType"] })}
              style={{ width: "100%", maxWidth: 320 }}
            >
              {OUTPUT_TYPE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <TemplateCanvas
            body={design.templateBody}
            onChange={(templateBody) => patch({ templateBody })}
          />
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn ghost" onClick={() => void generateSample()}>
              Generate sample PDF
            </button>
            {sampleMsg ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{sampleMsg}</span> : null}
          </div>
        </Card>
      ) : null}

      {tab === "Numbering" ? (
        <Card title="Certificate numbering">
          <NumberingFormatBuilder
            tokens={design.numberingTokens}
            onChange={(numberingTokens) => patch({ numberingTokens })}
          />
        </Card>
      ) : null}

      {tab === "Signatory" ? (
        <Card title="Signatory">
          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>Who signs?</span>
            <select
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
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={design.digitalSignature}
              onChange={(e) => patch({ digitalSignature: e.target.checked })}
            />
            Require digital signature
          </label>
        </Card>
      ) : null}

      {tab === "Validity" ? (
        <Card title="Validity">
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
                {mode === "duration" ? "Fixed duration" : mode === "fixed_date" ? "Until a fixed date" : "No expiry"}
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
                value={design.validityFixedDate}
                onChange={(e) => patch({ validityFixedDate: e.target.value })}
              />
            </label>
          ) : null}
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={design.renewable}
              onChange={(e) => patch({ renewable: e.target.checked })}
            />
            Renewable (links to renewal workflow when enabled)
          </label>
        </Card>
      ) : null}
    </div>
  );
}
