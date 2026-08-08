"use client";

import type {
  EngineBindingConfigUi,
  EngineBindingUi,
  EngineBlockUi,
  EngineDescriptorUi,
  EngineKeyUi,
  EnginePreviewResultUi,
  ExemptionCategoryUi,
} from "@/app/_components/ds/designer/engineBindingTypes";
import { emptyEngineBindingConfig } from "@/app/_components/ds/designer/engineBindingTypes";
import { updateServiceDefinition } from "./designerApi";

function asConfig(raw: unknown): EngineBindingConfigUi {
  const base = emptyEngineBindingConfig();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const cats = Array.isArray(r.exemptionCategories)
    ? r.exemptionCategories
      .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
      .map((c) => ({
        code: String(c.code ?? "").toUpperCase().slice(0, 32),
        label: String(c.label ?? c.code ?? "").slice(0, 80),
        percentBps: Math.max(0, Math.min(10_000, Number(c.percentBps) || 0)),
      }))
      .filter((c) => c.code)
    : [];
  const extras: Record<string, string> = {};
  if (r.extras && typeof r.extras === "object" && !Array.isArray(r.extras)) {
    for (const [k, v] of Object.entries(r.extras as Record<string, unknown>)) {
      extras[k] = String(v);
    }
  }
  return {
    exemptionCategories: cats,
    penaltyPercentBps: Math.max(0, Math.min(10_000, Number(r.penaltyPercentBps) || 0)),
    rebatePercentBps: Math.max(0, Math.min(10_000, Number(r.rebatePercentBps) || 0)),
    rebateWindowDays: Math.max(0, Number(r.rebateWindowDays) || 0),
    penaltyGraceDays: Math.max(0, Number(r.penaltyGraceDays) || 0),
    hoaCode: typeof r.hoaCode === "string" ? r.hoaCode : "",
    extras,
  };
}

export function normalizeBindingsFromApi(raw: unknown): EngineBindingUi[] {
  if (!Array.isArray(raw)) return [];
  const out: EngineBindingUi[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.block !== "string" || typeof r.engineKey !== "string") continue;
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : crypto.randomUUID(),
      block: r.block as EngineBlockUi,
      engineKey: r.engineKey as EngineKeyUi,
      config: asConfig(r.config),
      requiredForPublish: r.requiredForPublish !== false,
    });
  }
  return out;
}

export async function fetchEngineRegistry(block?: EngineBlockUi): Promise<EngineDescriptorUi[]> {
  const qs = block ? `?block=${encodeURIComponent(block)}` : "";
  const res = await fetch(`/api/proxy/v1/citizen/engines${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load engine registry (${res.status}).`);
  const json = (await res.json()) as { data?: EngineDescriptorUi[] };
  return Array.isArray(json.data) ? json.data.map((e) => ({
    ...e,
    defaultConfig: asConfig(e.defaultConfig),
  })) : [];
}

export async function previewEngineBinding(input: {
  binding: EngineBindingUi;
  basePrincipalMinor: number;
  selectedExemptions: string[];
  applyRebate: boolean;
  applyPenalty: boolean;
}): Promise<EnginePreviewResultUi> {
  const res = await fetch("/api/proxy/v1/citizen/engines/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Preview failed (${res.status}).`);
  }
  return res.json() as Promise<EnginePreviewResultUi>;
}

export async function persistEngineBindings(
  definitionId: string,
  bindings: EngineBindingUi[],
  opts?: { setFeeModelEngine?: boolean; hoaCode?: string },
): Promise<void> {
  const payload: {
    engineBindings: EngineBindingUi[];
    feeModel?: string;
    hoaCode?: string;
  } = { engineBindings: bindings };

  const feeBinding = bindings.find((b) => b.block === "fee" || b.block === "assessment");
  if (opts?.setFeeModelEngine && feeBinding) {
    payload.feeModel = "engine";
  }
  const hoa = opts?.hoaCode ?? feeBinding?.config.hoaCode;
  if (hoa) payload.hoaCode = hoa;

  await updateServiceDefinition(definitionId, payload);
}

export function newExemptionRow(): ExemptionCategoryUi {
  return {
    code: "",
    label: "",
    percentBps: 0,
  };
}

export function bindingFromDescriptor(
  eng: EngineDescriptorUi,
  block: EngineBlockUi,
): EngineBindingUi {
  return {
    id: crypto.randomUUID(),
    block,
    engineKey: eng.engineKey,
    config: asConfig(eng.defaultConfig),
    requiredForPublish: true,
  };
}
