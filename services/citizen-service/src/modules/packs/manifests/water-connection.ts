/**
 * municipal-in-v1 / pack:water-connection — Water & Sewerage Connection (BRD §8.1.2).
 *
 * The BRD's second pilot, chosen because it is structurally different from Trade
 * License: a longer chain with a document-verification lane BEFORE field
 * inspection, and an execution lane after approval — the physical work of laying
 * the connection — which no certificate service has.
 *
 * SCOPE, stated in the BRD: the one-time connection fee is Studio-configurable;
 * "recurring metered billing is out of scope v1". So this pack wires a single
 * demand on submission and does NOT pretend to model consumption billing. A pack
 * that implied metered billing would set an expectation the platform cannot meet.
 */

const WS_FORM_ID = "cccccccc-0001-4000-8000-000000000202";
const WS_WORKFLOW = "cccccccc-0003-4000-8000-000000000202";
const WS_FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000202";

const S1 = "ws-sec-property";
const S2 = "ws-sec-connection";
const S3 = "ws-sec-plumber";
const S4 = "ws-sec-docs";

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

export function waterConnectionFormDesign() {
  const fields = [
    field("ws-f1", "propertyId", "Property ID", "text", S1, {
      helpText: "The assessment number on your property tax receipt.",
    }),
    field("ws-f2", "ward", "Ward", "ward", S1),
    field("ws-f3", "propertyAddress", "Property address", "textarea", S1),
    field("ws-f4", "connectionType", "Connection type", "picklist_single", S2, {
      choices: ["Water only", "Sewerage only", "Water and sewerage"],
    }),
    field("ws-f5", "connectionCategory", "Category", "picklist_single", S2, {
      choices: ["Domestic", "Non-domestic", "Industrial", "Institutional"],
      helpText: "Category decides the connection fee.",
    }),
    field("ws-f6", "proposedPipeSize", "Pipe size (mm)", "picklist_single", S2, {
      choices: ["15", "20", "25", "40", "50"],
    }),
    field("ws-f7", "proposedTaps", "Number of taps", "number", S2),
    field("ws-f8", "roadType", "Road type at the connection point", "picklist_single", S2, {
      choices: ["Earthen", "Bitumen", "Concrete"],
      helpText: "Cutting a concrete road costs more to restore, so this affects the fee.",
    }),
    field("ws-f9", "roadCuttingRequired", "Is road cutting needed?", "picklist_single", S2, {
      choices: ["Yes", "No"],
    }),
    field("ws-f10", "plumberName", "Licensed plumber", "text", S3, {
      helpText: "The plumber who will carry out the work. They must hold a municipal licence.",
    }),
    field("ws-f11", "plumberLicenceNo", "Plumber licence number", "text", S3),
    field("ws-f12", "applicantName", "Applicant name", "profile_name", S3),
    field("ws-f13", "applicantMobile", "Mobile number", "profile_mobile", S3),
    field("ws-f14", "ownershipProof", "Proof of ownership", "file", S4, {
      fileTypes: ["pdf", "jpg"],
      fileMaxMb: 5,
    }),
    field("ws-f15", "sitePlan", "Site plan", "file", S4, { fileTypes: ["pdf"], fileMaxMb: 10 }),
  ];

  const fieldMap = Object.fromEntries(fields.map((f) => [f.id, f]));

  return {
    sections: [
      { id: S1, label: "Property", fieldIds: fields.filter((f) => f.sectionId === S1).map((f) => f.id) },
      { id: S2, label: "Connection required", fieldIds: fields.filter((f) => f.sectionId === S2).map((f) => f.id) },
      { id: S3, label: "Plumber and applicant", fieldIds: fields.filter((f) => f.sectionId === S3).map((f) => f.id) },
      { id: S4, label: "Documents", fieldIds: fields.filter((f) => f.sectionId === S4).map((f) => f.id) },
    ],
    fields: fieldMap,
    formId: WS_FORM_ID,
  };
}

export function waterConnectionManifestBlocks() {
  const form = waterConnectionFormDesign();
  return {
    description:
      "Apply for a new water and/or sewerage connection to your property. A one-time connection " +
      "fee applies, based on category, pipe size and road restoration. Ongoing water charges are billed separately.",
    slaDays: 30,
    formId: WS_FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: WS_FORM_ID }],
    workflowDefinitionId: WS_WORKFLOW,
    feeScheduleId: WS_FEE_SCHEDULE,
    // Slab, not flat: the fee varies by category, pipe size and road type, which
    // is exactly what FN-04's slab schedule exists for.
    feeModel: "slab" as const,
    hoaCode: "1401",
    issuanceType: "connection_order",
    outputs: [
      { type: "connection_order", templateKey: "ws-connection-order", numberingFormat: "WS/{ward}/{year}/{seq:5}" },
    ],
    requiredDocuments: [
      { docType: "ownership_proof", label: "Proof of ownership", mandatory: true, verifiedAtLane: "document_verification" },
      { docType: "site_plan", label: "Site plan", mandatory: true, verifiedAtLane: "document_verification" },
      { docType: "id_proof", label: "Identity proof", mandatory: true, verifiedAtLane: "document_verification" },
    ],
    /**
     * FN-25 — the BRD's chain: Submit → Document Verification → Field Inspection
     * → Approve → Execution → Issue. Execution is a real lane, not a formality:
     * the connection is not issued until the work is done, so the citizen's
     * status tracking reflects physical progress rather than paperwork.
     */
    laneBindings: [
      {
        key: "document_verification",
        name: "Document verification",
        enabled: true,
        designationId: "water_clerk",
        designationLabel: "Water Works Clerk",
        slaDays: 5,
        escalationDesignationId: "assistant_engineer_water",
        escalationDesignationLabel: "Assistant Engineer (Water)",
      },
      {
        key: "field_inspection",
        name: "Field inspection",
        enabled: true,
        designationId: "water_inspector",
        designationLabel: "Water Works Inspector",
        slaDays: 7,
        escalationDesignationId: "assistant_engineer_water",
        escalationDesignationLabel: "Assistant Engineer (Water)",
      },
      {
        key: "decision",
        name: "Approval",
        enabled: true,
        designationId: "assistant_engineer_water",
        designationLabel: "Assistant Engineer (Water)",
        slaDays: 5,
        escalationDesignationId: "executive_engineer_water",
        escalationDesignationLabel: "Executive Engineer (Water)",
      },
      {
        key: "execution",
        name: "Execution",
        enabled: true,
        designationId: "water_works_crew",
        designationLabel: "Water Works Crew",
        slaDays: 13,
        escalationDesignationId: "executive_engineer_water",
        escalationDesignationLabel: "Executive Engineer (Water)",
      },
    ],
    feeFromMinor: 250000,
    feeCurrency: "INR",
    channels: ["portal", "counter", "mobile"],
    appealLinkage: {
      appealable: true,
      filingWindowDays: 30,
      appellateDesignationId: "executive_engineer_water",
      appellateDesignationLabel: "Executive Engineer (Water)",
    },
  };
}

export function waterConnectionPackManifest() {
  return {
    businessService: "WS",
    pilot: true,
    blocks: waterConnectionManifestBlocks(),
  };
}
