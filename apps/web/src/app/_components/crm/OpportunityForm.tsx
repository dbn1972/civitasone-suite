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
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../DataSourceBadge";
import { Button, EntityPicker, type EntityOption } from "../ds";
import { browserFetch } from "@/lib/api/browserClient";
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
  onSaved?: (id: string | null) => void;
  /** Prefill the account link (e.g. from `/crm/opportunities/new?accountId=…`). */
  initialAccountId?: string;
  /** Pre-known label for `initialAccountId` so the picker shows a name immediately. */
  initialAccountLabel?: string;
}

const inputStyle = { padding: 8, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

/**
 * Account search for the EntityPicker. Accounts are listed from the existing
 * `GET /v1/crm/accounts` endpoint; the result is filtered client-side on the typed
 * query (the list endpoint has no server-side search param). Returns [] on any failure
 * so the picker degrades to "no results" rather than throwing.
 */
async function searchAccounts(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  try {
    const res = await browserFetch("v1/crm/accounts", { signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
    const q = query.trim().toLowerCase();
    return (body.data ?? [])
      .filter((a): a is { id: string; name: string } => Boolean(a.id && a.name))
      .filter((a) => (q ? a.name.toLowerCase().includes(q) : true))
      .slice(0, 20)
      .map((a) => ({ id: a.id, label: a.name }));
  } catch {
    return [];
  }
}

async function resolveAccounts(ids: string[]): Promise<EntityOption[]> {
  try {
    const res = await browserFetch("v1/crm/accounts", {});
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
    const want = new Set(ids);
    return (body.data ?? [])
      .filter((a): a is { id: string; name: string } => Boolean(a.id && a.name && want.has(a.id)))
      .map((a) => ({ id: a.id, label: a.name }));
  } catch {
    return [];
  }
}

export function OpportunityForm({ opportunity, onSaved, initialAccountId, initialAccountLabel }: OpportunityFormProps) {
  const t = useTranslations("crmOpportunityForm");
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [source, setSource] = useState<OpSource | "loading">("loading");

  const [name, setName] = useState(opportunity?.name ?? "");
  const [pipelineId, setPipelineId] = useState(opportunity?.pipelineId ?? "");
  const [stage, setStage] = useState(opportunity?.stage ?? "");
  const [accountId, setAccountId] = useState<string | null>(opportunity?.accountId ?? initialAccountId ?? null);
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
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const formId = useId();

  const initialOptions = useMemo<EntityOption[]>(
    () => (initialAccountId && initialAccountLabel ? [{ id: initialAccountId, label: initialAccountLabel }] : []),
    [initialAccountId, initialAccountLabel],
  );

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

  // On a fresh create, once we've saved we must NOT allow a second submit — that is the
  // duplicate-deal bug (GAP-CRM-OPPORTUNITIES-NEW-01). `saved` latches true after the
  // first successful create and gates the Create button until the user resets the form.
  const canSubmit =
    name.trim().length > 0 && pipelineId.length > 0 && stage.length > 0 && valueValid && probValid && qtyValid && !busy && !saved;

  function resetForNext() {
    setName("");
    setStage(selectedPipeline?.stages[0]?.key ?? "");
    setAccountId(null);
    setValueRupees("");
    setProbability("");
    setProduct("");
    setQuantity("");
    setCompetitors("");
    setNextStep("");
    setExpectedCloseDate("");
    setSaved(false);
    setMessage("");
    setError("");
    setMissing([]);
  }

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
      // Link the opportunity to an account when one is chosen. On edit, fall back to the
      // record's existing accountId so a save never silently unlinks it.
      ...(accountId ? { accountId } : opportunity?.accountId ? { accountId: opportunity.accountId } : {}),
    };
    setBusy(true);
    try {
      if (opportunity?.id) {
        await updateOpportunity(opportunity.id, payload);
        setMessage(t("saved", { name: payload.name }));
        onSaved?.(opportunity.id);
      } else {
        const id = await createOpportunity(payload);
        // Latch saved=true so a second Create click can't POST a duplicate deal.
        setSaved(true);
        setMessage(t("created", { name: payload.name }));
        onSaved?.(id);
      }
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

  // GAP-CRM-OPPORTUNITIES-NEW-03: the mandatory fields for the chosen stage are
  // known client-side (selectedPipeline stage.mandatoryFields), so surface them
  // BEFORE submit — an inline hint plus a star on each required label — instead
  // of only after the server rejects the save. The server stays the authority.
  const selectedStage = useMemo(
    () => selectedPipeline?.stages.find((s) => s.key === stage) ?? null,
    [selectedPipeline, stage],
  );
  const requiredFields = selectedStage?.mandatoryFields ?? [];
  const isRequired = (field: OppFieldKey) => requiredFields.includes(field);
  // Star a label when the stage requires it OR the server flagged it missing.
  const star = (field: OppFieldKey) => (isRequired(field) || isMissing(field) ? " *" : "");

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

        {requiredFields.length > 0 ? (
          <p role="note" style={{ fontSize: 12, color: "var(--muted)", margin: 0, padding: "0 2px" }}>
            {t("requiredForStage", { fields: requiredFields.map((f) => OPP_FIELD_LABELS[f]).join(", ") })}
          </p>
        ) : null}

        <div style={{ fontSize: 13, display: "grid", gap: 4 }}>
          <span aria-hidden="true">{t("accountLabel")}</span>
          <EntityPicker
            aria-label={t("accountAria")}
            value={accountId}
            onChange={(v) => setAccountId(typeof v === "string" ? v : null)}
            search={searchAccounts}
            resolve={resolveAccounts}
            initialOptions={initialOptions}
            placeholder={t("accountPlaceholder")}
          />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {t("accountHint")}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Value (₹){star("value")}
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
            Probability (%){star("probability")}
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
            Quantity{star("quantity")}
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
          Product{star("product")}
          <input aria-label="Product" value={product} aria-invalid={isMissing("product") ? true : undefined} onChange={(e) => setProduct(e.target.value)} style={inputStyle} />
        </label>

        <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
          Competitors (comma separated){star("competitors")}
          <input aria-label="Competitors" value={competitors} aria-invalid={isMissing("competitors") ? true : undefined} onChange={(e) => setCompetitors(e.target.value)} style={inputStyle} placeholder="Acme, Globex" />
        </label>

        <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
          Next step{star("nextStep")}
          <input aria-label="Next step" value={nextStep} aria-invalid={isMissing("nextStep") ? true : undefined} onChange={(e) => setNextStep(e.target.value)} style={inputStyle} />
        </label>

        <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
          Expected close date{star("expectedCloseDate")}
          <input aria-label="Expected close date" type="date" value={expectedCloseDate} aria-invalid={isMissing("expectedCloseDate") ? true : undefined} onChange={(e) => setExpectedCloseDate(e.target.value)} style={inputStyle} />
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <Button type="button" onClick={() => void submit()} disabled={busy || saved} aria-busy={busy}>
            {busy ? t("saving") : saved ? t("createdStatus") : opportunity ? t("saveOpportunity") : t("createOpportunity")}
          </Button>
          {saved && !opportunity ? (
            <Button type="button" variant="ghost" onClick={resetForNext}>
              {t("createAnother")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
