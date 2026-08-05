"use client";
/**
 * OpportunityForm — OP-003. Create or edit an opportunity: value (rupees → paise
 * with no float), probability, product, quantity, competitors, next step and
 * expected close date, on a chosen pipeline + stage. When the backend rejects a
 * stage entry with 422 MANDATORY_STAGE_FIELDS_MISSING, the exact missing fields
 * are surfaced inline against the form — we never silently drop the rejection.
 * Money is converted with rupeesToMinorString and shown back with formatMoney.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";
import {
  getPipelines,
  createOpportunity,
  updateOpportunity,
  MandatoryFieldsError,
  OPP_FIELD_LABELS,
  type Opportunity,
  type Pipeline,
  type OppFieldKey,
  type OpSource,
} from "@/lib/crm/opportunity";

interface OpportunityFormProps {
  opportunity?: Opportunity;
  onSaved?: () => void;
}

const inputStyle = { padding: 8, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

export function OpportunityForm({ opportunity, onSaved }: OpportunityFormProps) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [source, setSource] = useState<OpSource | "loading">("loading");

  const [name, setName] = useState(opportunity?.name ?? "");
  const [pipelineId, setPipelineId] = useState(opportunity?.pipelineId ?? "");
  const [stage, setStage] = useState(opportunity?.stage ?? "");
  const [valueRupees, setValueRupees] = useState(
    opportunity ? (BigInt(opportunity.valueMinor || "0") / 100n).toString() + "." + (BigInt(opportunity.valueMinor || "0") % 100n).toString().padStart(2, "0") : "",
  );
  const [probability, setProbability] = useState(opportunity ? String(opportunity.probability) : "");
  const [product, setProduct] = useState(opportunity?.product ?? "");
  const [quantity, setQuantity] = useState(opportunity ? String(opportunity.quantity) : "");
  const [competitors, setCompetitors] = useState((opportunity?.competitors ?? []).join(", "));
  const [nextStep, setNextStep] = useState(opportunity?.nextStep ?? "");
  const [expectedCloseDate, setExpectedCloseDate] = useState(opportunity?.expectedCloseDate?.slice(0, 10) ?? "");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const formId = useId();

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, source: s } = await getPipelines();
      if (!live) return;
      setPipelines(data);
      setSource(s);
      if (!opportunity && data.length > 0) {
        setPipelineId((prev) => prev || data[0].id || "");
      }
    })();
    return () => {
      live = false;
    };
  }, [opportunity]);

  const selectedPipeline = useMemo(
    () => pipelines.find((p) => p.id === pipelineId) ?? null,
    [pipelines, pipelineId],
  );

  // Default the stage to the pipeline's first stage when none chosen.
  useEffect(() => {
    if (selectedPipeline && !stage && selectedPipeline.stages.length > 0) {
      setStage(selectedPipeline.stages[0].key);
    }
  }, [selectedPipeline, stage]);

  const valueMinor = valueRupees.trim() ? rupeesToMinorString(valueRupees.trim()) : "0";
  const valueValid = valueMinor !== null;
  const probNum = Number(probability);
  const probValid = probability.trim() === "" || (Number.isFinite(probNum) && probNum >= 0 && probNum <= 100);
  const qtyNum = Number(quantity);
  const qtyValid = quantity.trim() === "" || (Number.isInteger(qtyNum) && qtyNum >= 0);

  const canSubmit =
    name.trim().length > 0 && pipelineId.length > 0 && stage.length > 0 && valueValid && probValid && qtyValid && !busy;

  async function submit() {
    setMessage("");
    setError("");
    setMissing([]);
    if (!canSubmit) {
      if (!valueValid) setError("Enter the deal value as a plain rupee amount (max 2 decimals).");
      else if (!probValid) setError("Probability must be a whole number between 0 and 100.");
      else if (!qtyValid) setError("Quantity must be a whole number.");
      else setError("Name, pipeline and stage are required.");
      return;
    }
    const payload: Opportunity = {
      ...(opportunity?.id ? { id: opportunity.id } : {}),
      name: name.trim(),
      pipelineId,
      stage,
      valueMinor: valueMinor ?? "0",
      probability: probability.trim() === "" ? 0 : probNum,
      product: product.trim(),
      quantity: quantity.trim() === "" ? 0 : qtyNum,
      competitors: competitors.split(",").map((c) => c.trim()).filter((c) => c.length > 0),
      nextStep: nextStep.trim(),
      expectedCloseDate,
      ...(opportunity?.accountId ? { accountId: opportunity.accountId } : {}),
    };
    setBusy(true);
    try {
      if (opportunity?.id) await updateOpportunity(opportunity.id, payload);
      else await createOpportunity(payload);
      setMessage(`Opportunity “${payload.name}” saved.`);
      onSaved?.();
    } catch (e) {
      if (e instanceof MandatoryFieldsError) {
        setMissing(e.missingFields);
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : "Could not save the opportunity.");
      }
    } finally {
      setBusy(false);
    }
  }

  const isMissing = (field: OppFieldKey) => missing.includes(field);

  return (
    <div className="card">
      <div className="card-h">
        <h3>{opportunity ? "Edit opportunity" : "New opportunity"}</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>

      {source === "error" ? (
        <p style={{ fontSize: 13, color: "var(--muted)", padding: "0 12px" }}>
          Pipelines could not be loaded just now. You can still enter a stage key manually.
        </p>
      ) : null}
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>
          {error}
        </p>
      ) : null}
      {missing.length > 0 ? (
        <p role="alert" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>
          This stage needs: {missing.map((f) => OPP_FIELD_LABELS[f as OppFieldKey] ?? f).join(", ")}.
        </p>
      ) : null}

      <div style={{ display: "grid", gap: 12, padding: 12, maxWidth: 720 }}>
        <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
          Name
          <input aria-label="Opportunity name" value={name} aria-invalid={name.trim() ? undefined : true} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="e.g. State datacentre refresh" />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Pipeline
            <select aria-label="Pipeline" value={pipelineId} onChange={(e) => { setPipelineId(e.target.value); setStage(""); }} style={inputStyle}>
              <option value="">Select a pipeline…</option>
              {pipelines.map((p) => (
                <option key={p.id ?? p.name} value={p.id ?? ""}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Stage
            {selectedPipeline ? (
              <select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)} style={inputStyle}>
                <option value="">Select a stage…</option>
                {selectedPipeline.stages.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name}
                    {s.mandatoryFields.length > 0 ? ` (needs ${s.mandatoryFields.length})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)} style={inputStyle} placeholder="stage key" />
            )}
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Value (₹){isMissing("value") ? " *" : ""}
            <input
              aria-label="Deal value in rupees"
              inputMode="decimal"
              value={valueRupees}
              aria-invalid={!valueValid || isMissing("value") ? true : undefined}
              onChange={(e) => setValueRupees(e.target.value)}
              style={inputStyle}
              placeholder="0.00"
            />
            {valueRupees.trim() && valueValid ? (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{formatMoney(valueMinor!)}</span>
            ) : null}
          </label>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Probability (%){isMissing("probability") ? " *" : ""}
            <input
              aria-label="Probability percent"
              type="number"
              min={0}
              max={100}
              value={probability}
              aria-invalid={!probValid || isMissing("probability") ? true : undefined}
              onChange={(e) => setProbability(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Quantity{isMissing("quantity") ? " *" : ""}
            <input
              aria-label="Quantity"
              type="number"
              min={0}
              value={quantity}
              aria-invalid={!qtyValid || isMissing("quantity") ? true : undefined}
              onChange={(e) => setQuantity(e.target.value)}
              style={inputStyle}
            />
          </label>
        </div>

        <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
          Product{isMissing("product") ? " *" : ""}
          <input aria-label="Product" value={product} aria-invalid={isMissing("product") ? true : undefined} onChange={(e) => setProduct(e.target.value)} style={inputStyle} />
        </label>

        <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
          Competitors (comma separated){isMissing("competitors") ? " *" : ""}
          <input aria-label="Competitors" value={competitors} aria-invalid={isMissing("competitors") ? true : undefined} onChange={(e) => setCompetitors(e.target.value)} style={inputStyle} placeholder="Acme, Globex" />
        </label>

        <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
          Next step{isMissing("nextStep") ? " *" : ""}
          <input aria-label="Next step" value={nextStep} aria-invalid={isMissing("nextStep") ? true : undefined} onChange={(e) => setNextStep(e.target.value)} style={inputStyle} />
        </label>

        <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
          Expected close date{isMissing("expectedCloseDate") ? " *" : ""}
          <input aria-label="Expected close date" type="date" value={expectedCloseDate} aria-invalid={isMissing("expectedCloseDate") ? true : undefined} onChange={(e) => setExpectedCloseDate(e.target.value)} style={inputStyle} />
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn primary" onClick={() => void submit()} disabled={busy} aria-busy={busy}>
            {busy ? "Saving…" : opportunity ? "Save opportunity" : "Create opportunity"}
          </button>
        </div>
      </div>
    </div>
  );
}
