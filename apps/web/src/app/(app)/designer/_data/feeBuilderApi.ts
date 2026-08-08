"use client";

import type { FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";
import type { EligibilityOp } from "@/app/_components/ds/designer/eligibilityTypes";
import type {
  FeeDesignState,
  FeeExemptionUi,
  FeeModelUi,
  SampleCalculation,
  SamplePaymentScenario,
  SlabRowUi,
} from "@/app/_components/ds/designer/feeTypes";

interface ApiExemption {
  id: string;
  attribute: string;
  op: EligibilityOp;
  value?: unknown;
  kind: "waive" | "percent" | "flat";
  amount?: number;
  label?: string;
}

interface FeeScheduleDto {
  id: string;
  serviceId: string;
  name: string;
  baseAmount: number;
  currency: string;
  exemptions: ApiExemption[];
}

interface MajorHeadDto {
  code: string;
  description: string;
  sector?: string;
}

async function parseJson(res: Response): Promise<unknown> {
  if (!(res.ok || res.status === 202)) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json();
}

function parseRuleValue(raw: string | undefined, op: EligibilityOp): unknown {
  if (!raw && op !== "exists" && op !== "missing") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  const num = Number(raw);
  if (raw !== "" && Number.isFinite(num)) return num;
  return raw;
}

function evaluatePredicate(ex: FeeExemptionUi, subject: Record<string, unknown>): boolean {
  const present = Object.prototype.hasOwnProperty.call(subject, ex.attribute)
    && subject[ex.attribute] !== null && subject[ex.attribute] !== undefined;
  const actual = subject[ex.attribute];
  const expected = parseRuleValue(ex.value, ex.op);

  switch (ex.op) {
    case "exists": return present;
    case "missing": return !present;
    case "eq": return present && actual === expected;
    case "neq": return actual !== expected;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = Number(actual);
      const b = Number(expected);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      if (ex.op === "gt") return a > b;
      if (ex.op === "gte") return a >= b;
      if (ex.op === "lt") return a < b;
      return a <= b;
    }
    default:
      return false;
  }
}

export function exemptionsUiToApi(exemptions: FeeExemptionUi[]): ApiExemption[] {
  return exemptions.map((ex) => ({
    id: ex.id,
    attribute: ex.attribute,
    op: ex.op,
    value: parseRuleValue(ex.value, ex.op),
    kind: ex.kind,
    amount: ex.kind === "waive" ? undefined : Math.trunc(Number(ex.amount) || 0),
    label: ex.label || undefined,
  }));
}

export function exemptionsApiToUi(exemptions: ApiExemption[]): FeeExemptionUi[] {
  return exemptions.map((ex) => ({
    id: ex.id,
    attribute: ex.attribute,
    op: ex.op,
    value: ex.value === undefined || ex.value === null ? "" : String(ex.value),
    kind: ex.kind,
    amount: ex.amount === undefined ? "" : String(ex.amount),
    label: ex.label ?? "",
  }));
}

/** Client-side flat fee compute (mirrors citizen-service fee-payment domain). */
export function computeFlatFeeLocal(
  baseAmountPaise: number,
  exemptions: FeeExemptionUi[],
  subject: Record<string, unknown>,
): { baseAmount: number; amount: number; exemptionLabel: string | null } {
  const base = Math.max(0, Math.trunc(baseAmountPaise));
  for (const ex of exemptions) {
    if (!evaluatePredicate(ex, subject)) continue;
    let amount = base;
    if (ex.kind === "waive") amount = 0;
    else if (ex.kind === "percent") {
      const pct = Math.min(100, Math.max(0, Math.trunc(Number(ex.amount) || 0)));
      amount = base - Math.trunc((base * pct) / 100);
    } else if (ex.kind === "flat") {
      amount = base - Math.max(0, Math.trunc(Number(ex.amount) || 0));
    }
    return { baseAmount: base, amount: Math.max(0, amount), exemptionLabel: ex.label || ex.id };
  }
  return { baseAmount: base, amount: base, exemptionLabel: null };
}

/** Simplified slab preview for designer sample rail. */
export function computeSlabFeeLocal(slabs: SlabRowUi[], sampleValue: number): number {
  const value = Math.max(0, Math.trunc(sampleValue));
  const flat = slabs.find((s) => s.type === "flat");
  if (flat) return Math.max(0, Math.trunc(Number(flat.rate) || 0));

  const adVal = slabs.find((s) => s.type === "ad_valorem");
  if (adVal) {
    const bps = BigInt(Math.trunc(Number(adVal.rate) || 0));
    return Number((BigInt(value) * bps) / 10000n);
  }

  const bands = slabs
    .filter((s) => s.type === "band")
    .sort((a, b) => Number(a.from || 0) - Number(b.from || 0));

  let total = 0;
  for (const band of bands) {
    const from = Math.trunc(Number(band.from) || 0);
    const toRaw = band.to === "" ? value : Math.trunc(Number(band.to) || 0);
    if (value <= from) break;
    const taxable = Math.min(value, toRaw) - from;
    const rate = Math.trunc(Number(band.rate) || 0);
    total += Math.trunc((taxable * rate) / 100);
  }
  return Math.max(0, total);
}

function applyScenarioAdjustments(
  principalPaise: number,
  design: FeeDesignState,
  scenario: SamplePaymentScenario,
  lines: SampleCalculation["lines"],
): number {
  let total = principalPaise;

  if (scenario === "early" && design.rebateDays > 0) {
    const pct = Math.min(100, Math.max(0, Math.trunc(design.rebatePercent || 0)));
    const rebate = pct > 0 ? -Math.trunc((principalPaise * pct) / 100) : 0;
    lines.push({
      label: pct > 0
        ? `Rebate (${pct}% · within ${design.rebateDays} days)`
        : `Rebate window (${design.rebateDays} days) — set rebate % to preview`,
      amountPaise: rebate,
      taxHeadCode: "REBATE",
      kind: "rebate",
    });
    total += rebate;
  } else if (scenario === "late" && design.penaltyDays >= 0 && design.penaltyPercent > 0) {
    const pct = Math.min(100, Math.max(0, Math.trunc(design.penaltyPercent || 0)));
    const penalty = Math.trunc((principalPaise * pct) / 100);
    lines.push({
      label: `Penalty (${pct}% · after ${design.penaltyDays} days grace)`,
      amountPaise: penalty,
      taxHeadCode: "PENALTY",
      kind: "penalty",
    });
    total += penalty;
  } else if (scenario === "late" && design.penaltyDays > 0 && design.penaltyPercent <= 0) {
    lines.push({
      label: `Penalty grace (${design.penaltyDays} days) — set penalty % to preview`,
      amountPaise: 0,
      taxHeadCode: "PENALTY",
      kind: "info",
    });
  }

  return Math.max(0, total);
}

export function buildSampleCalculation(
  design: FeeDesignState,
  subject: Record<string, unknown>,
  sampleNumeric: number,
  scenario: SamplePaymentScenario = "on_time",
): SampleCalculation {
  const currency = "INR";
  const lines: SampleCalculation["lines"] = [];

  if (design.feeModel === "flat") {
    const result = computeFlatFeeLocal(design.baseAmountPaise, design.exemptions, subject);
    lines.push({
      label: "Base fee",
      amountPaise: result.baseAmount,
      taxHeadCode: "BASE",
      kind: "base",
    });
    if (result.exemptionLabel && result.amount < result.baseAmount) {
      lines.push({
        label: `Exemption (${result.exemptionLabel})`,
        amountPaise: result.amount - result.baseAmount,
        taxHeadCode: "EXEMPTION",
        kind: "exemption",
      });
    }
    const totalPaise = applyScenarioAdjustments(result.amount, design, scenario, lines);
    return { lines, totalPaise, currency, hoaCode: design.hoaCode || undefined, scenario };
  }

  if (design.feeModel === "slab") {
    const principal = computeSlabFeeLocal(design.slabs, sampleNumeric);
    lines.push({
      label: "Base (slab)",
      amountPaise: principal,
      taxHeadCode: "BASE",
      kind: "base",
    });
    const totalPaise = applyScenarioAdjustments(principal, design, scenario, lines);
    return { lines, totalPaise, currency, hoaCode: design.hoaCode || undefined, scenario };
  }

  if (design.feeModel === "engine") {
    lines.push({
      label: "Engine fee (live preview unavailable in designer)",
      amountPaise: 0,
      taxHeadCode: "BASE",
      kind: "info",
    });
    return { lines, totalPaise: 0, currency, hoaCode: design.hoaCode || undefined, scenario };
  }

  return { lines: [], totalPaise: 0, currency, hoaCode: design.hoaCode || undefined, scenario };
}

export function emptyFeeDesign(serviceName: string): FeeDesignState {
  return {
    feeModel: null,
    name: `${serviceName} fee`,
    baseAmountPaise: 0,
    exemptions: [],
    slabs: [],
    slabVariable: "",
    engineParams: {},
    hoaCode: "",
    demandTrigger: "submission",
    rebateDays: 0,
    rebatePercent: 0,
    penaltyDays: 0,
    penaltyPercent: 0,
  };
}

export async function loadFeeDesign(
  serviceId: string,
  serviceName: string,
  opts: {
    feeModel?: string | null;
    feeScheduleId?: string | null;
    hoaCode?: string | null;
  },
): Promise<FeeDesignState> {
  const base = emptyFeeDesign(serviceName);
  base.feeModel = (opts.feeModel as FeeModelUi | null) ?? null;
  base.hoaCode = opts.hoaCode ?? "";
  base.scheduleId = opts.feeScheduleId ?? undefined;

  if (opts.feeScheduleId) {
    const listRes = await fetch("/api/proxy/v1/citizen/fees/schedules", { cache: "no-store" });
    if (listRes.ok) {
      const payload = (await listRes.json()) as { data?: FeeScheduleDto[] };
      const sched = (payload.data ?? []).find((s) => s.id === opts.feeScheduleId);
      if (sched) {
        base.name = sched.name;
        base.baseAmountPaise = sched.baseAmount;
        base.exemptions = exemptionsApiToUi(sched.exemptions ?? []);
        base.feeModel = "flat";
      }
    }
  } else if (serviceId) {
    const listRes = await fetch("/api/proxy/v1/citizen/fees/schedules", { cache: "no-store" });
    if (listRes.ok) {
      const payload = (await listRes.json()) as { data?: FeeScheduleDto[] };
      const sched = (payload.data ?? []).find((s) => s.serviceId === serviceId);
      if (sched) {
        base.scheduleId = sched.id;
        base.name = sched.name;
        base.baseAmountPaise = sched.baseAmount;
        base.exemptions = exemptionsApiToUi(sched.exemptions ?? []);
        base.feeModel = base.feeModel ?? "flat";
      }
    }
  }

  return base;
}

export async function fetchHoaOptions(): Promise<{ code: string; label: string }[]> {
  const res = await fetch("/api/proxy/v1/finance/major-heads", { cache: "no-store" });
  if (!res.ok) return [];
  const payload = (await res.json()) as { data?: MajorHeadDto[] };
  return (payload.data ?? []).map((h) => ({
    code: h.code,
    label: `${h.code} — ${h.description}`,
  }));
}

export async function persistFeeDesign(
  design: FeeDesignState,
  serviceId: string,
  serviceName: string,
): Promise<FeeDesignState> {
  if (!design.feeModel) return design;

  let scheduleId = design.scheduleId;
  let rateHeadId = design.rateHeadId;

  if (design.feeModel === "flat") {
    const body = {
      serviceId,
      name: design.name || `${serviceName} fee`,
      baseAmount: design.baseAmountPaise,
      currency: "INR",
      exemptions: exemptionsUiToApi(design.exemptions),
    };
    const created = (await parseJson(await fetch("/api/proxy/v1/citizen/fees/schedules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }))) as { id: string };
    scheduleId = created.id;
  }

  if (design.feeModel === "slab" && design.slabs.length > 0) {
    if (!rateHeadId) {
      const slug = serviceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20);
      const head = (await parseJson(await fetch("/api/proxy/v1/revenue/rate-heads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: `${slug}-${crypto.randomUUID().slice(0, 6)}`,
          name: `${serviceName} rate`,
          category: "service_fee",
          unitOfMeasure: design.slabVariable || "unit",
        }),
      }))) as { data?: { id: string } };
      rateHeadId = head.data?.id;
    }

    if (rateHeadId) {
      const today = new Date().toISOString().slice(0, 10);
      for (const slab of design.slabs) {
        await parseJson(await fetch("/api/proxy/v1/revenue/rate-slabs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            rateHeadId,
            slabType: slab.type,
            bandFrom: slab.type === "flat" ? undefined : slab.from || "0",
            bandTo: slab.type === "flat" || slab.to === "" ? undefined : slab.to,
            rateValue: slab.rate || "0",
            effectiveFrom: today,
          }),
        }));
      }
    }
  }

  return {
    ...design,
    scheduleId,
    rateHeadId,
  };
}

export function rupeesInputToPaise(input: string): number {
  const rupees = Number(input);
  if (!Number.isFinite(rupees) || rupees < 0) return 0;
  return Math.round(rupees * 100);
}

export function paiseToRupeesInput(paise: number): string {
  if (paise <= 0) return "";
  return (paise / 100).toFixed(2).replace(/\.?0+$/, "");
}

export function buildSampleSubjectFields(
  exemptions: FeeExemptionUi[],
  formFields: FormFieldDefinition[],
): { id: string; label: string; valueType: "text" | "number" | "boolean" }[] {
  const seen = new Set<string>();
  const fields: { id: string; label: string; valueType: "text" | "number" | "boolean" }[] = [];
  for (const ex of exemptions) {
    if (seen.has(ex.attribute)) continue;
    seen.add(ex.attribute);
    const form = formFields.find((f) => f.apiName === ex.attribute);
    fields.push({
      id: ex.attribute,
      label: form?.label ?? ex.attribute.replace(/_/g, " "),
      valueType: form?.type === "number" ? "number" : form?.type === "boolean" ? "boolean" : "text",
    });
  }
  return fields;
}
