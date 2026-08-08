/**
 * municipal-in-v1 / pack:trade-license — canonical pilot manifest (B1–B8 minimal wiring).
 * Embedded formDesign lets FN-13 runtime render without per-service frontend code.
 */

const TL_FORM_ID = "cccccccc-0001-4000-8000-000000000001";
const TL_ELIGIBILITY = "cccccccc-0002-4000-8000-000000000001";
const TL_WORKFLOW = "cccccccc-0003-4000-8000-000000000001";
const TL_FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000001";

const S1 = "tl-sec-business";
const S2 = "tl-sec-owner";
const S3 = "tl-sec-docs";

function field(
  id: string,
  apiName: string,
  label: string,
  type: string,
  sectionId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    apiName,
    type,
    label,
    required: extra.required === false ? false : true,
    sectionId,
    ...extra,
  };
}

export function tradeLicenseFormDesign() {
  const fields = [
    field("tl-f1", "tradeName", "Trade / business name", "text", S1),
    field("tl-f2", "propertyId", "Property ID", "text", S1, { helpText: "Municipal property reference, if known", required: false }),
    field("tl-f3", "applicationDate", "Application date", "date", S1),
    field("tl-f4", "licenseType", "License type", "picklist_single", S1, { choices: ["TEMPORARY", "PERMANENT"] }),
    field("tl-f5", "tradeCategory", "Trade category", "picklist_single", S1, {
      choices: ["Retail", "Manufacturing", "Services", "Food & beverage"],
    }),
    field("tl-f6", "tradeSubcategory", "Trade sub-category", "text", S1),
    field("tl-f7", "unitOfMeasure", "Unit of measure", "text", S1, { required: false }),
    field("tl-f8", "ownerName", "Owner / applicant name", "profile_name", S2),
    field("tl-f9", "ownerMobile", "Mobile number", "profile_mobile", S2),
    field("tl-f10", "ownerEmail", "Email", "profile_email", S2, { required: false }),
    field("tl-f11", "businessAddress", "Business address", "address", S2),
    field("tl-f12", "ward", "Ward", "ward", S2),
    field("tl-f13", "idProof", "Identity proof", "file", S3, { fileTypes: ["pdf", "jpg"], fileMaxMb: 5 }),
    field("tl-f14", "addressProof", "Address proof", "file", S3, { fileTypes: ["pdf", "jpg"], fileMaxMb: 5 }),
    field("tl-f15", "tradePhoto", "Shop / trade photo", "file", S3, { fileTypes: ["jpg", "png"], fileMaxMb: 5 }),
  ];

  const fieldMap = Object.fromEntries(fields.map((f) => [f.id, f]));

  return {
    sections: [
      { id: S1, label: "Business details", fieldIds: fields.filter((f) => f.sectionId === S1).map((f) => f.id) },
      { id: S2, label: "Owner details", fieldIds: fields.filter((f) => f.sectionId === S2).map((f) => f.id) },
      { id: S3, label: "Documents", fieldIds: fields.filter((f) => f.sectionId === S3).map((f) => f.id) },
    ],
    fields: fieldMap,
    formId: TL_FORM_ID,
  };
}

/** Stable block wiring applied on pack import — passes FN-10 sandbox when complete. */
export function tradeLicenseManifestBlocks() {
  const form = tradeLicenseFormDesign();
  return {
    description:
      "Apply for a municipal trade license. Fee varies by category. Inspection and approval required before issuance.",
    slaDays: 15,
    formId: TL_FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: TL_FORM_ID }],
    eligibilityRuleSetId: TL_ELIGIBILITY,
    workflowDefinitionId: TL_WORKFLOW,
    feeScheduleId: TL_FEE_SCHEDULE,
    feeModel: "flat" as const,
    hoaCode: "4201",
    issuanceType: "certificate",
    outputs: [{ type: "certificate", templateKey: "tl-certificate", numberingFormat: "TL/{ward}/{year}/{seq:5}" }],
    requiredDocuments: [
      { docType: "id_proof", label: "Identity proof", mandatory: true, verifiedAtLane: "inspection" },
      { docType: "address_proof", label: "Address proof", mandatory: true, verifiedAtLane: "inspection" },
      { docType: "trade_photo", label: "Shop / trade photo", mandatory: true, verifiedAtLane: "inspection" },
    ],
    /** FN-25 — per-lane SLA clocks + superior designations for escalation. */
    laneBindings: [
      {
        key: "inspection",
        name: "Inspection",
        enabled: true,
        designationId: "licensing_inspector",
        designationLabel: "Licensing Inspector",
        slaDays: 7,
        escalationDesignationId: "licensing_officer",
        escalationDesignationLabel: "Licensing Officer",
      },
      {
        key: "decision",
        name: "Decision",
        enabled: true,
        designationId: "licensing_officer",
        designationLabel: "Licensing Officer",
        slaDays: 5,
        escalationDesignationId: "chief_licensing_officer",
        escalationDesignationLabel: "Chief Licensing Officer",
      },
    ],
    feeFromMinor: 50000,
    feeCurrency: "INR",
    channels: ["portal", "counter", "mobile"],
  };
}

export function tradeLicensePackManifest() {
  return {
    businessService: "TL",
    pilot: true,
    blocks: tradeLicenseManifestBlocks(),
  };
}
