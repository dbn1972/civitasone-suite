/**
 * municipal-in-v1 / pack:property-tax — Property Tax Self-Assessment (BRD §8.1.5).
 *
 * THIS PACK IS DELIBERATELY NOT STUDIO-PURE. The BRD is explicit: "not
 * Studio-pure — bind to `revenue.assessment` engine; Studio edits exemptions,
 * penalty/rebate %, windows, HOA only … the assessment engine remains
 * engineered."
 *
 * So the fee here is an ENGINE BINDING, not a fee schedule. What a Department
 * Head may change without engineering is the parameter set: which exemption
 * categories exist and at what percentage, the rebate and penalty rates, the
 * windows they apply in, and the head of account. What tax is actually owed on a
 * given property is computed by revenue.assessment and is not authorable here.
 *
 * Writing this pack with a flat or slab feeModel would be the dishonest option:
 * it would look Studio-configurable, and would then compute the wrong tax.
 *
 * Collection pattern specifics (hiddenBlocksForPattern("collection")): B3
 * eligibility, B4 approval chain and B6 documents are hidden. Self-assessment is
 * a declaration followed by a demand — there is nobody to approve and nothing to
 * upload — so this pack wires none of them.
 */

const PT_FORM_ID = "cccccccc-0001-4000-8000-000000000204";
const PT_ENGINE_BINDING_ID = "cccccccc-0005-4000-8000-000000000204";

const S1 = "pt-sec-property";
const S2 = "pt-sec-structure";
const S3 = "pt-sec-owner";

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

export function propertyTaxFormDesign() {
  const fields = [
    field("pt-f1", "assessmentNumber", "Assessment number", "text", S1, {
      helpText: "On your previous demand notice. Leave blank if this is a first assessment.",
      required: false,
    }),
    field("pt-f2", "ward", "Ward", "ward", S1),
    field("pt-f3", "propertyAddress", "Property address", "textarea", S1),
    field("pt-f4", "propertyType", "Property type", "picklist_single", S1, {
      choices: ["Independent house", "Apartment / flat", "Vacant land", "Commercial building"],
    }),
    field("pt-f5", "propertySubType", "Property sub-type", "picklist_single", S1, {
      choices: ["Owner occupied", "Rented", "Partly rented", "Vacant"],
      required: false,
    }),
    field("pt-f6", "usageCategory", "Usage", "picklist_single", S2, {
      choices: ["Residential", "Commercial", "Industrial", "Institutional", "Mixed"],
      helpText: "Usage strongly affects the tax rate.",
    }),
    field("pt-f7", "noOfFloors", "Number of floors", "number", S2),
    field("pt-f8", "landArea", "Land area (sq m)", "number", S2),
    field("pt-f9", "buildUpArea", "Built-up area (sq m)", "number", S2),
    field("pt-f10", "constructionYear", "Year of construction", "number", S2, { required: false }),
    field("pt-f11", "ownershipCategory", "Ownership category", "picklist_single", S3, {
      choices: ["Individual", "Joint", "Institution", "Government"],
    }),
    field("pt-f12", "ownerName", "Owner name", "profile_name", S3),
    field("pt-f13", "ownerMobile", "Mobile number", "profile_mobile", S3),
    field("pt-f14", "exemptionClaimed", "Exemption claimed", "picklist_single", S3, {
      choices: ["None", "Senior citizen", "Ex-serviceman", "Person with disability"],
      required: false,
      helpText: "Exemptions are applied by the assessment engine after verification.",
    }),
  ];

  const fieldMap = Object.fromEntries(fields.map((f) => [f.id, f]));

  return {
    sections: [
      { id: S1, label: "Property", fieldIds: fields.filter((f) => f.sectionId === S1).map((f) => f.id) },
      { id: S2, label: "Structure and usage", fieldIds: fields.filter((f) => f.sectionId === S2).map((f) => f.id) },
      { id: S3, label: "Ownership", fieldIds: fields.filter((f) => f.sectionId === S3).map((f) => f.id) },
    ],
    fields: fieldMap,
    formId: PT_FORM_ID,
  };
}

export function propertyTaxManifestBlocks() {
  const form = propertyTaxFormDesign();
  return {
    description:
      "Declare your property details to generate this year's property tax demand. " +
      "The amount is calculated from your declaration; rebates apply for early payment.",
    slaDays: 3,
    formId: PT_FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: PT_FORM_ID }],
    // No workflowDefinitionId, no laneBindings, no requiredDocuments: B4 and B6
    // are hidden for the Collection pattern. Assessment is a machine step, not a
    // human lane, so inventing an approver here would add a queue nobody works.
    // No feeModel / feeScheduleId — the amount comes from the engine below.
    hoaCode: "1101",
    issuanceType: "demand_notice",
    outputs: [
      { type: "demand_notice", templateKey: "pt-demand-notice", numberingFormat: "PT/{ward}/{year}/{seq:6}" },
    ],
    requiredDocuments: [],
    /**
     * FN-21 — the assessment engine. `requiredForPublish` is true because a
     * property tax service that published without it would produce demands of
     * zero. The parameters below are the whole of what Studio may edit.
     */
    engineBindings: [
      {
        id: PT_ENGINE_BINDING_ID,
        block: "assessment" as const,
        engineKey: "revenue.assessment" as const,
        requiredForPublish: true,
        config: {
          exemptionCategories: [
            { code: "SENIOR", label: "Senior citizen", percentBps: 1000 },
            { code: "EXSERV", label: "Ex-serviceman", percentBps: 1500 },
            { code: "PWD", label: "Person with disability", percentBps: 1000 },
          ],
          // 12% p.a. penalty after a 15-day grace; 5% rebate for paying within 30 days.
          penaltyPercentBps: 1200,
          penaltyGraceDays: 15,
          rebatePercentBps: 500,
          rebateWindowDays: 30,
          hoaCode: "1101",
          extras: { businessService: "PT" },
        },
      },
    ],
    channels: ["portal", "counter", "mobile"],
    /**
     * FN-27 — objecting to an assessment is a statutory right, and the citizen is
     * objecting to a machine-computed figure, so the path matters more here than
     * on a service where a human made the call.
     */
    appealLinkage: {
      appealable: true,
      filingWindowDays: 30,
      appellateDesignationId: "revenue_officer",
      appellateDesignationLabel: "Revenue Officer",
      statutoryReference: "Assessment objection — Municipal Act",
    },
  };
}

export function propertyTaxPackManifest() {
  return {
    businessService: "PT",
    pilot: false,
    /** Honesty marker: Studio authors parameters, not the computation. */
    studioScope: "parameters-only",
    blocks: propertyTaxManifestBlocks(),
  };
}
