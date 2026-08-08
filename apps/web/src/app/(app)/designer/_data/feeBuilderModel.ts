import type { FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";
import type {
  FeeDesignState,
  FeeExemptionUi,
  FeeModelUi,
} from "@/app/_components/ds/designer/feeTypes";

export interface FeeModelCardMeta {
  id: FeeModelUi;
  title: string;
  description: string;
  stepHint: string;
}

export const FEE_MODEL_CARDS: FeeModelCardMeta[] = [
  {
    id: "flat",
    title: "Fixed fee",
    description: "One amount, optional exemptions",
    stepHint: "Set the rupee amount and any reductions",
  },
  {
    id: "slab",
    title: "Slab or formula",
    description: "Depends on area, units, category…",
    stepHint: "Define rate bands or an advanced formula",
  },
  {
    id: "engine",
    title: "Engine",
    description: "Computed by an assessment engine — you set parameters only",
    stepHint: "Tune engine parameters; amounts come from the bound engine",
  },
];

export type FeeWizardStep = 1 | 2 | 3;

/** Visible wizard step for guided B5 authoring. */
export function feeWizardStep(design: Pick<FeeDesignState, "feeModel">): FeeWizardStep {
  if (!design.feeModel) return 1;
  return 2;
}

export function filterHoaOptions(
  options: { code: string; label: string }[],
  query: string,
): { code: string; label: string }[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (o) => o.code.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
  );
}

/** HOA is required once a fee model is chosen — block submit/next here, not at publish. */
export function isHoaBlocking(design: Pick<FeeDesignState, "feeModel" | "hoaCode">): boolean {
  return Boolean(design.feeModel) && !design.hoaCode.trim();
}

export function hoaBlockMessage(design: Pick<FeeDesignState, "feeModel" | "hoaCode">): string | null {
  if (!isHoaBlocking(design)) return null;
  return "Choose a Head of Account before you continue — payments cannot post without it.";
}

export function isFeeDesignReadyToAdvance(design: FeeDesignState): boolean {
  if (!design.feeModel) return false;
  if (isHoaBlocking(design)) return false;
  if (design.feeModel === "flat") return design.baseAmountPaise > 0;
  if (design.feeModel === "slab") return design.slabs.length > 0 || Boolean(design.formula?.trim());
  return true;
}

/** Fill sample subject so the first matching exemption applies (BRD micro-enterprise demo). */
export function suggestExemptSampleValues(
  exemptions: FeeExemptionUi[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const ex of exemptions) {
    if (ex.op === "exists") {
      values[ex.attribute] = "yes";
      continue;
    }
    if (ex.op === "missing") continue;
    if (ex.value !== "") values[ex.attribute] = ex.value;
  }
  return values;
}

/** Fill sample subject so exemptions do not match (full fee). */
export function suggestFullFeeSampleValues(
  exemptions: FeeExemptionUi[],
  formFields: FormFieldDefinition[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const ex of exemptions) {
    if (ex.op === "eq") {
      const form = formFields.find((f) => f.apiName === ex.attribute);
      if (form?.type === "boolean") values[ex.attribute] = "false";
      else if (form?.type === "number") values[ex.attribute] = String((Number(ex.value) || 0) + 1);
      else values[ex.attribute] = ex.value ? `${ex.value}_other` : "other";
    } else if (ex.op === "exists") {
      // leave unset so exists fails
    } else if (ex.op === "missing") {
      values[ex.attribute] = "present";
    } else if (ex.value !== "") {
      values[ex.attribute] = ex.value;
    }
  }
  return values;
}

export function modelCardDisabled(
  model: FeeModelUi,
  engineAvailable: boolean,
): boolean {
  return model === "engine" && !engineAvailable;
}
