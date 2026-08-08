"use client";

import type { FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";
import type { IssuanceDesignState } from "@/app/_components/ds/designer/issuanceTypes";
import { emptyIssuanceDesign, formatNumberingPreview } from "@/app/_components/ds/designer/issuanceTypes";
import { buildSandboxPreview, type SandboxPreviewResult } from "./issuanceBuilderModel";

export interface IssuanceOutputConfig {
  kind: "issuance";
  outputType: string;
  templateBody: string;
  numberingFormat: string;
  numberingTokens: IssuanceDesignState["numberingTokens"];
  signatoryDesignationId: string;
  signatoryLabel: string;
  digitalSignature: boolean;
  validityMode: string;
  validityYears: number;
  validityFixedDate: string;
  renewable: boolean;
  renewalWindowDays: number;
  orientation: string;
  qrVerifyEnabled: boolean;
}

export function issuanceUiToOutput(design: IssuanceDesignState): IssuanceOutputConfig {
  return {
    kind: "issuance",
    outputType: design.outputType,
    templateBody: design.templateBody,
    numberingFormat: formatNumberingPreview(design.numberingTokens),
    numberingTokens: design.numberingTokens,
    signatoryDesignationId: design.signatoryDesignationId,
    signatoryLabel: design.signatoryLabel,
    digitalSignature: design.digitalSignature,
    validityMode: design.validityMode,
    validityYears: design.validityYears,
    validityFixedDate: design.validityFixedDate,
    renewable: design.renewable,
    renewalWindowDays: design.renewalWindowDays,
    orientation: design.orientation,
    qrVerifyEnabled: design.qrVerifyEnabled,
  };
}

export function issuanceOutputToUi(
  outputs: unknown[] | undefined | null,
  pattern: string,
  issuanceType?: string | null,
): IssuanceDesignState {
  const base = emptyIssuanceDesign(pattern);
  const cfg = (outputs ?? []).find(
    (o): o is IssuanceOutputConfig =>
      typeof o === "object" && o !== null && (o as IssuanceOutputConfig).kind === "issuance",
  );
  if (!cfg) {
    if (issuanceType) base.outputType = issuanceType as IssuanceDesignState["outputType"];
    return base;
  }
  return {
    outputType: (cfg.outputType as IssuanceDesignState["outputType"]) ?? base.outputType,
    templateBody: cfg.templateBody ?? base.templateBody,
    numberingTokens: cfg.numberingTokens ?? base.numberingTokens,
    signatoryDesignationId: cfg.signatoryDesignationId ?? "",
    signatoryLabel: cfg.signatoryLabel ?? "",
    digitalSignature: cfg.digitalSignature ?? false,
    validityMode: (cfg.validityMode as IssuanceDesignState["validityMode"]) ?? base.validityMode,
    validityYears: cfg.validityYears ?? base.validityYears,
    validityFixedDate: cfg.validityFixedDate ?? "",
    renewable: cfg.renewable ?? false,
    renewalWindowDays: cfg.renewalWindowDays ?? base.renewalWindowDays,
    orientation: (cfg.orientation as IssuanceDesignState["orientation"]) ?? base.orientation,
    qrVerifyEnabled: cfg.qrVerifyEnabled ?? base.qrVerifyEnabled,
  };
}

export function mergeOutputsWithIssuance(
  existing: unknown[] | undefined | null,
  issuance: IssuanceOutputConfig,
): unknown[] {
  const rest = (existing ?? []).filter(
    (o) => !(typeof o === "object" && o !== null && (o as { kind?: string }).kind === "issuance"),
  );
  return [...rest, issuance];
}

export interface SamplePdfResult extends SandboxPreviewResult {
  ok: boolean;
  message: string;
}

/** Probe issuance request endpoint; always return an honest sandbox/pipeline preview. */
export async function requestSamplePdf(
  design: IssuanceDesignState,
  serviceName: string,
  formFields: FormFieldDefinition[] = [],
): Promise<SamplePdfResult> {
  let pipelineAvailable = false;
  try {
    const res = await fetch("/api/proxy/v1/citizen/certificates/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        certType: design.outputType,
        subject: {
          service_name: serviceName,
          applicant_name: "Sample Applicant",
        },
        payload: {
          templateBody: design.templateBody,
          preview: true,
          sandbox: true,
        },
      }),
    });
    pipelineAvailable = res.ok || res.status === 202;
  } catch {
    pipelineAvailable = false;
  }

  const preview = buildSandboxPreview(design, serviceName, {
    pipelineAvailable,
    formFields,
  });

  return {
    ...preview,
    ok: true,
    message: preview.banner,
  };
}

export async function fetchTenantPositions(): Promise<{ id: string; label: string }[]> {
  try {
    const res = await fetch("/api/proxy/v1/tenant/positions", { cache: "no-store" });
    if (!res.ok) return [];
    const payload = (await res.json()) as { data?: { id: string; title?: string; name?: string }[] };
    return (payload.data ?? []).map((p) => ({
      id: p.id,
      label: p.title ?? p.name ?? p.id,
    }));
  } catch {
    return [];
  }
}
