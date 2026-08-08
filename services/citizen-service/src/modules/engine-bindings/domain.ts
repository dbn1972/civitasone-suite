/**
 * FN-21 — Engine Binding Configuration (pure domain, no I/O).
 *
 * Links a Pack / service-definition block to engineered backend logic.
 * Studio authors parameters (exemptions, penalty/rebate windows, HOA);
 * compute stays in the bound engine.
 */

import { randomUUID } from "node:crypto";

export const ENGINE_BLOCKS = [
  "fee",
  "assessment",
  "verification",
  "numbering",
  "inspection",
] as const;
export type EngineBlock = (typeof ENGINE_BLOCKS)[number];

export const ENGINE_KEYS = [
  "revenue.assessment",
  "revenue.rate-engine",
  "revenue.billing",
  "inspection.planning",
  "police.verification",
  "crs.birth-death",
] as const;
export type EngineKey = (typeof ENGINE_KEYS)[number];

export interface EngineParamField {
  key: string;
  label: string;
  type: "string" | "number" | "percent_bps" | "days" | "hoa" | "exemption_list";
  required?: boolean;
  help?: string;
}

export interface EngineDescriptor {
  engineKey: EngineKey;
  label: string;
  description: string;
  blocks: EngineBlock[];
  /** Honesty: false when the backend is stubbed / not deployed. */
  available: boolean;
  unavailableReason?: string;
  configSchema: EngineParamField[];
  defaultConfig: Record<string, unknown>;
}

export interface ExemptionCategory {
  code: string;
  label: string;
  /** Reduction in basis points (10000 = 100%). */
  percentBps: number;
}

export interface EngineBindingConfig {
  exemptionCategories: ExemptionCategory[];
  penaltyPercentBps: number;
  rebatePercentBps: number;
  rebateWindowDays: number;
  penaltyGraceDays: number;
  hoaCode: string;
  /** Opaque engine-specific extras (rate head id, business service, …). */
  extras: Record<string, string>;
}

export interface EngineBinding {
  id: string;
  block: EngineBlock;
  engineKey: EngineKey;
  config: EngineBindingConfig;
  requiredForPublish: boolean;
}

const FEE_ASSESSMENT_SCHEMA: EngineParamField[] = [
  {
    key: "exemptionCategories",
    label: "Exemption categories",
    type: "exemption_list",
    help: "Categories applicants may claim; assessment compute stays in the engine.",
  },
  {
    key: "rebatePercentBps",
    label: "Early rebate (%)",
    type: "percent_bps",
    help: "Studio parameter — applied by the bound engine on preview / demand.",
  },
  {
    key: "rebateWindowDays",
    label: "Rebate window (days before due)",
    type: "days",
  },
  {
    key: "penaltyPercentBps",
    label: "Penalty (%)",
    type: "percent_bps",
  },
  {
    key: "penaltyGraceDays",
    label: "Penalty grace (days)",
    type: "days",
  },
  {
    key: "hoaCode",
    label: "Head of Account",
    type: "hoa",
    required: true,
  },
];

/** Platform engine registry — designer picker + honesty gate source. */
export const ENGINE_REGISTRY: readonly EngineDescriptor[] = [
  {
    engineKey: "revenue.assessment",
    label: "Property / assessment engine",
    description: "Municipal self-assessment (PT). Studio edits exemptions and windows only.",
    blocks: ["fee", "assessment"],
    available: true,
    configSchema: FEE_ASSESSMENT_SCHEMA,
    defaultConfig: {
      exemptionCategories: [
        { code: "SENIOR", label: "Senior citizen", percentBps: 1000 },
        { code: "EXSERV", label: "Ex-serviceman", percentBps: 1500 },
      ],
      penaltyPercentBps: 1200,
      rebatePercentBps: 500,
      rebateWindowDays: 30,
      penaltyGraceDays: 15,
      hoaCode: "",
      extras: { businessService: "PT" },
    },
  },
  {
    engineKey: "revenue.rate-engine",
    label: "Rate engine",
    description: "Slab / ad-valorem compute with rebate and penalty rules.",
    blocks: ["fee", "assessment"],
    available: true,
    configSchema: FEE_ASSESSMENT_SCHEMA,
    defaultConfig: {
      exemptionCategories: [],
      penaltyPercentBps: 1000,
      rebatePercentBps: 0,
      rebateWindowDays: 0,
      penaltyGraceDays: 0,
      hoaCode: "",
      extras: {},
    },
  },
  {
    engineKey: "revenue.billing",
    label: "Billing / demand engine",
    description: "Demand notice generation for collection services.",
    blocks: ["fee"],
    available: true,
    configSchema: FEE_ASSESSMENT_SCHEMA.filter((f) => f.key === "hoaCode" || f.key === "exemptionCategories"),
    defaultConfig: {
      exemptionCategories: [],
      penaltyPercentBps: 0,
      rebatePercentBps: 0,
      rebateWindowDays: 0,
      penaltyGraceDays: 0,
      hoaCode: "",
      extras: {},
    },
  },
  {
    engineKey: "inspection.planning",
    label: "Inspection planning",
    description: "Schedules site inspection lanes via inspection-service.",
    blocks: ["inspection"],
    available: true,
    configSchema: [
      { key: "extras.laneKey", label: "Inspection lane key", type: "string", required: true },
    ],
    defaultConfig: {
      exemptionCategories: [],
      penaltyPercentBps: 0,
      rebatePercentBps: 0,
      rebateWindowDays: 0,
      penaltyGraceDays: 0,
      hoaCode: "",
      extras: { laneKey: "site_inspection" },
    },
  },
  {
    engineKey: "police.verification",
    label: "Police verification API",
    description: "External character / tenant verification — engineered backend required.",
    blocks: ["verification"],
    available: false,
    unavailableReason: "Police verification adapter is not deployed in this environment.",
    configSchema: [
      { key: "extras.endpointRef", label: "Adapter reference", type: "string" },
    ],
    defaultConfig: {
      exemptionCategories: [],
      penaltyPercentBps: 0,
      rebatePercentBps: 0,
      rebateWindowDays: 0,
      penaltyGraceDays: 0,
      hoaCode: "",
      extras: {},
    },
  },
  {
    engineKey: "crs.birth-death",
    label: "Civil registration (birth/death)",
    description: "Statutory CRS parameters — registration compute stays in the engine.",
    blocks: ["fee", "numbering"],
    available: false,
    unavailableReason: "CRS engine binding is parameter-only until the registrar adapter ships.",
    configSchema: FEE_ASSESSMENT_SCHEMA.filter((f) => f.key !== "exemptionCategories"),
    defaultConfig: {
      exemptionCategories: [],
      penaltyPercentBps: 0,
      rebatePercentBps: 0,
      rebateWindowDays: 0,
      penaltyGraceDays: 0,
      hoaCode: "",
      extras: {},
    },
  },
] as const;

export function isEngineKey(value: unknown): value is EngineKey {
  return typeof value === "string" && (ENGINE_KEYS as readonly string[]).includes(value);
}

export function isEngineBlock(value: unknown): value is EngineBlock {
  return typeof value === "string" && (ENGINE_BLOCKS as readonly string[]).includes(value);
}

export function findEngine(engineKey: string): EngineDescriptor | undefined {
  return ENGINE_REGISTRY.find((e) => e.engineKey === engineKey);
}

export function emptyBindingConfig(): EngineBindingConfig {
  return {
    exemptionCategories: [],
    penaltyPercentBps: 0,
    rebatePercentBps: 0,
    rebateWindowDays: 0,
    penaltyGraceDays: 0,
    hoaCode: "",
    extras: {},
  };
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function normalizeExemptions(raw: unknown): ExemptionCategory[] {
  if (!Array.isArray(raw)) return [];
  const out: ExemptionCategory[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const code = typeof r.code === "string" ? r.code.trim().toUpperCase() : "";
    const label = typeof r.label === "string" ? r.label.trim() : code;
    if (!code) continue;
    out.push({
      code: code.slice(0, 32),
      label: (label || code).slice(0, 80),
      percentBps: Math.max(0, Math.min(10_000, Math.round(asNumber(r.percentBps, 0)))),
    });
  }
  return out;
}

export function normalizeBindingConfig(raw: unknown): EngineBindingConfig {
  const base = emptyBindingConfig();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const extrasRaw = r.extras;
  const extras: Record<string, string> = {};
  if (extrasRaw && typeof extrasRaw === "object" && !Array.isArray(extrasRaw)) {
    for (const [k, v] of Object.entries(extrasRaw as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        extras[k.slice(0, 64)] = String(v).slice(0, 256);
      }
    }
  }
  return {
    exemptionCategories: normalizeExemptions(r.exemptionCategories),
    penaltyPercentBps: Math.max(0, Math.min(10_000, Math.round(asNumber(r.penaltyPercentBps, 0)))),
    rebatePercentBps: Math.max(0, Math.min(10_000, Math.round(asNumber(r.rebatePercentBps, 0)))),
    rebateWindowDays: Math.max(0, Math.min(3650, Math.round(asNumber(r.rebateWindowDays, 0)))),
    penaltyGraceDays: Math.max(0, Math.min(3650, Math.round(asNumber(r.penaltyGraceDays, 0)))),
    hoaCode: typeof r.hoaCode === "string" ? r.hoaCode.trim().slice(0, 32) : "",
    extras,
  };
}

/** Coerce unknown JSON (DB / API) into typed bindings; drops invalid rows. */
export function normalizeEngineBindings(raw: unknown): EngineBinding[] {
  if (!Array.isArray(raw)) return [];
  const out: EngineBinding[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (!isEngineBlock(r.block) || !isEngineKey(r.engineKey)) continue;
    const id = typeof r.id === "string" && r.id.length > 0 ? r.id : cryptoRandomId();
    out.push({
      id,
      block: r.block,
      engineKey: r.engineKey,
      config: normalizeBindingConfig(r.config ?? r.configRef),
      requiredForPublish: r.requiredForPublish !== false,
    });
  }
  return out;
}

function cryptoRandomId(): string {
  return randomUUID();
}

export function hasLiveFeeEngineBinding(bindings: readonly EngineBinding[]): boolean {
  return bindings.some((b) => {
    if (b.block !== "fee" && b.block !== "assessment") return false;
    const eng = findEngine(b.engineKey);
    return Boolean(eng?.available);
  });
}

export function assertBindingsPublishable(bindings: readonly EngineBinding[]): void {
  for (const b of bindings) {
    if (!b.requiredForPublish) continue;
    const eng = findEngine(b.engineKey);
    if (!eng) throw new Error(`ENGINE_UNKNOWN:${b.engineKey}`);
    if (!eng.available) throw new Error(`ENGINE_UNAVAILABLE:${b.engineKey}`);
    if ((b.block === "fee" || b.block === "assessment") && !b.config.hoaCode) {
      throw new Error("ENGINE_HOA_REQUIRED");
    }
  }
}

export interface EnginePreviewLine {
  taxHeadCode: string;
  label: string;
  amountMinor: number;
}

export interface EnginePreviewResult {
  engineKey: EngineKey;
  available: boolean;
  lines: EnginePreviewLine[];
  totalMinor: number;
  currency: "INR";
  appliedExemptions: string[];
  note: string;
}

/**
 * Parameter-aware preview for Studio sample calculation.
 * Assessment principal stays opaque (engine-owned); Studio parameters
 * (exemptions / rebate / penalty windows) adjust the sample demand lines.
 */
export function previewEngineDemand(input: {
  binding: EngineBinding;
  /** Sample principal in paise before Studio parameters. */
  basePrincipalMinor: number;
  /** Selected exemption category codes. */
  selectedExemptions?: string[];
  /** When true, apply rebate window parameter as early-payment rebate. */
  applyRebate?: boolean;
  /** When true, apply penalty parameter (post-grace). */
  applyPenalty?: boolean;
}): EnginePreviewResult {
  const eng = findEngine(input.binding.engineKey);
  if (!eng || !eng.available) {
    return {
      engineKey: input.binding.engineKey,
      available: false,
      lines: [],
      totalMinor: 0,
      currency: "INR",
      appliedExemptions: [],
      note: eng?.unavailableReason
        ?? "Bound engine is missing or stubbed — sandbox will fail until a live engine is bound.",
    };
  }

  const cfg = input.binding.config;
  let principal = Math.max(0, Math.round(input.basePrincipalMinor));
  const selected = new Set((input.selectedExemptions ?? []).map((c) => c.toUpperCase()));
  const applied: string[] = [];
  let exemptionMinor = 0;
  for (const cat of cfg.exemptionCategories) {
    if (!selected.has(cat.code)) continue;
    const cut = Math.floor((principal * cat.percentBps) / 10_000);
    exemptionMinor += cut;
    applied.push(cat.code);
  }
  principal = Math.max(0, principal - exemptionMinor);

  const rebateMinor = input.applyRebate && cfg.rebatePercentBps > 0
    ? Math.floor((principal * cfg.rebatePercentBps) / 10_000)
    : 0;
  const penaltyMinor = input.applyPenalty && cfg.penaltyPercentBps > 0
    ? Math.floor((principal * cfg.penaltyPercentBps) / 10_000)
    : 0;

  const lines: EnginePreviewLine[] = [
    { taxHeadCode: "BASE", label: "Assessed amount (engine)", amountMinor: principal + exemptionMinor },
  ];
  if (exemptionMinor > 0) {
    lines.push({ taxHeadCode: "EXEMPTION", label: "Exemptions", amountMinor: -exemptionMinor });
  }
  if (rebateMinor > 0) {
    lines.push({
      taxHeadCode: "REBATE",
      label: `Early rebate (${cfg.rebateWindowDays}d window)`,
      amountMinor: -rebateMinor,
    });
  }
  if (penaltyMinor > 0) {
    lines.push({
      taxHeadCode: "PENALTY",
      label: `Penalty (after ${cfg.penaltyGraceDays}d grace)`,
      amountMinor: penaltyMinor,
    });
  }

  const totalMinor = principal - rebateMinor + penaltyMinor;
  return {
    engineKey: input.binding.engineKey,
    available: true,
    lines,
    totalMinor,
    currency: "INR",
    appliedExemptions: applied,
    note: "Preview applies Studio parameters only; assessment compute remains in the bound engine.",
  };
}

export function enginesForBlock(block: EngineBlock): EngineDescriptor[] {
  return ENGINE_REGISTRY.filter((e) => e.blocks.includes(block));
}

export function defaultBindingForEngine(engineKey: EngineKey, block: EngineBlock): EngineBinding {
  const eng = findEngine(engineKey);
  return {
    id: cryptoRandomId(),
    block,
    engineKey,
    config: normalizeBindingConfig(eng?.defaultConfig ?? emptyBindingConfig()),
    requiredForPublish: true,
  };
}
