/**
 * pack:sewer-connection — Dedicated Sewerage Connection (BRD §5.5 SEWER-001/002).
 *
 * A water-connection variant scoped to sewerage-only applications. The BRD draws
 * a distinction between a combined water-and-sewerage request (which water-
 * connection already handles via "Sewerage only" or "Water and sewerage" in its
 * connectionType picklist) and a dedicated sewerage service for ULBs that process
 * them independently — separate fee heads, separate approval chains, separate SLA.
 *
 * This pack exists so that a ULB whose water and sewerage departments are separate
 * (common in larger municipalities) can import a ready-made config without editing
 * the water-connection pack's form to hide the water fields. The form asks for
 * property, connection class, existing drainage, and plumber — it does NOT ask for
 * pipe size or taps, which are water-supply concepts.
 */

import { field, formDesignFrom, rupees } from "./_shared.js";

const FORM_ID = "cccccccc-0001-4000-8000-000000000401";
const WORKFLOW = "cccccccc-0003-4000-8000-000000000401";
const FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000401";

const S1 = "sw-sec-property";
const S2 = "sw-sec-connection";
const S3 = "sw-sec-applicant";
const S4 = "sw-sec-docs";

export function sewerConnectionFormDesign() {
  const fields = [
    field("sw-f1", "propertyId", "Property ID", "text", S1, {
      helpText: "The assessment number on your property tax receipt.",
    }),
    field("sw-f2", "ward", "Ward", "ward", S1),
    field("sw-f3", "propertyAddress", "Property address", "textarea", S1),
    field("sw-f4", "existingWaterConnection", "Do you have a water connection?", "picklist_single", S2, {
      choices: ["Yes", "No", "Applied separately"],
      helpText: "A sewerage connection is usually linked to the water supply.",
    }),
    field("sw-f5", "connectionCategory", "Category", "picklist_single", S2, {
      choices: ["Domestic", "Non-domestic", "Industrial", "Institutional"],
      helpText: "Category decides the connection fee.",
    }),
    field("sw-f6", "drainageType", "Existing drainage", "picklist_single", S2, {
      choices: ["None", "Open drain", "Septic tank", "Soak pit"],
      helpText: "Tells the crew what needs to be replaced or connected.",
    }),
    field("sw-f7", "roadType", "Road type at the connection point", "picklist_single", S2, {
      choices: ["Earthen", "Bitumen", "Concrete"],
      helpText: "Road cutting charges depend on the surface type.",
    }),
    field("sw-f8", "plumberName", "Licensed plumber", "text", S3, {
      helpText: "The plumber who will carry out the work.",
    }),
    field("sw-f9", "plumberLicenceNo", "Plumber licence number", "text", S3),
    field("sw-f10", "applicantName", "Applicant name", "profile_name", S3),
    field("sw-f11", "applicantMobile", "Mobile number", "profile_mobile", S3),
    field("sw-f12", "ownershipProof", "Proof of ownership", "file", S4, {
      fileTypes: ["pdf", "jpg"],
      fileMaxMb: 5,
    }),
    field("sw-f13", "sitePlan", "Site plan / drainage layout", "file", S4, {
      fileTypes: ["pdf"],
      fileMaxMb: 10,
      helpText: "Show the proposed connection point and the route to the nearest trunk sewer.",
    }),
  ];

  return formDesignFrom(fields, [
    { id: S1, label: "Property" },
    { id: S2, label: "Sewerage connection" },
    { id: S3, label: "Plumber and applicant" },
    { id: S4, label: "Documents" },
  ], FORM_ID);
}

export function sewerConnectionManifestBlocks() {
  const form = sewerConnectionFormDesign();
  return {
    description:
      "Apply for a new sewerage connection to your property. A one-time connection fee applies, " +
      "based on category and road restoration. Ongoing sewerage charges are billed separately.",
    slaDays: 30,
    formId: FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: FORM_ID }],
    workflowDefinitionId: WORKFLOW,
    feeScheduleId: FEE_SCHEDULE,
    feeModel: "slab" as const,
    hoaCode: "1402",
    issuanceType: "connection_order",
    outputs: [
      { type: "connection_order", templateKey: "sw-connection-order", numberingFormat: "SW/{ward}/{year}/{seq:5}" },
    ],
    requiredDocuments: [
      { docType: "ownership_proof", label: "Proof of ownership", mandatory: true, verifiedAtLane: "document_verification" },
      { docType: "site_plan", label: "Site plan / drainage layout", mandatory: true, verifiedAtLane: "document_verification" },
      { docType: "id_proof", label: "Identity proof", mandatory: true, verifiedAtLane: "document_verification" },
    ],
    laneBindings: [
      {
        key: "document_verification",
        name: "Document verification",
        enabled: true,
        designationId: "sewerage_clerk",
        designationLabel: "Sewerage Section Clerk",
        slaDays: 5,
        escalationDesignationId: "assistant_engineer_sewerage",
        escalationDesignationLabel: "Assistant Engineer (Sewerage)",
      },
      {
        key: "field_inspection",
        name: "Field inspection",
        enabled: true,
        designationId: "sewerage_inspector",
        designationLabel: "Sewerage Inspector",
        slaDays: 7,
        escalationDesignationId: "assistant_engineer_sewerage",
        escalationDesignationLabel: "Assistant Engineer (Sewerage)",
      },
      {
        key: "decision",
        name: "Approval",
        enabled: true,
        designationId: "assistant_engineer_sewerage",
        designationLabel: "Assistant Engineer (Sewerage)",
        slaDays: 5,
        escalationDesignationId: "executive_engineer_sewerage",
        escalationDesignationLabel: "Executive Engineer (Sewerage)",
      },
      {
        key: "execution",
        name: "Execution",
        enabled: true,
        designationId: "sewerage_works_crew",
        designationLabel: "Sewerage Works Crew",
        slaDays: 13,
        escalationDesignationId: "executive_engineer_sewerage",
        escalationDesignationLabel: "Executive Engineer (Sewerage)",
      },
    ],
    feeFromMinor: rupees(2000),
    feeCurrency: "INR",
    channels: ["portal", "counter", "mobile"],
    appealLinkage: {
      appealable: true,
      filingWindowDays: 30,
      appellateDesignationId: "executive_engineer_sewerage",
      appellateDesignationLabel: "Executive Engineer (Sewerage)",
    },
  };
}

export function sewerConnectionPackManifest() {
  return { businessService: "SW", pilot: false, blocks: sewerConnectionManifestBlocks() };
}
