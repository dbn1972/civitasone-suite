/**
 * pack:market-stall — Municipal market shop / stall allotment.
 *
 * Allotment of a municipal market stall, which is a licence to occupy rather than
 * a tenancy. The recurring rent is a SEPARATE Collection service
 * (pack:municipal-property-rent) — deliberately, because allotment happens once
 * and rent recurs monthly, and folding them together would force a citizen
 * through an allotment form to pay a bill.
 *
 * Allotment is competitive: more applicants than stalls. So the pack captures
 * the reservation category and existing-allottee status that most municipal
 * allotment rules turn on, and routes through a committee lane rather than a
 * single officer's discretion.
 */

import { field, formDesignFrom, rupees } from "./_shared.js";

const FORM_ID = "cccccccc-0001-4000-8000-000000000307";
const WORKFLOW = "cccccccc-0003-4000-8000-000000000307";
const FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000307";

const S1 = "ms-sec-stall";
const S2 = "ms-sec-applicant";
const S3 = "ms-sec-eligibility";
const S4 = "ms-sec-docs";

export function marketStallFormDesign() {
  const fields = [
    field("ms-f1", "marketName", "Market", "text", S1),
    field("ms-f2", "ward", "Ward", "ward", S1),
    field("ms-f3", "stallType", "Type of stall", "picklist_single", S1, {
      choices: ["Shop", "Open stall", "Fish / meat stall", "Vegetable platform", "Godown"],
    }),
    field("ms-f4", "stallNumber", "Preferred stall number", "text", S1, {
      required: false,
      helpText: "If you have one in mind. Allotment is subject to availability and the committee's decision.",
    }),
    field("ms-f5", "tradeProposed", "Trade you will carry on", "text", S1),
    field("ms-f6", "applicantName", "Applicant name", "profile_name", S2),
    field("ms-f7", "applicantMobile", "Mobile number", "profile_mobile", S2),
    field("ms-f8", "applicantAddress", "Address", "textarea", S2),
    field("ms-f9", "reservationCategory", "Reservation category", "picklist_single", S3, {
      choices: ["General", "Scheduled Caste", "Scheduled Tribe", "Other Backward Class", "Person with disability", "Woman applicant"],
      helpText: "Stalls are reserved as per municipal allotment rules.",
    }),
    field("ms-f10", "existingAllotment", "Do you already hold a municipal stall?", "picklist_single", S3, {
      choices: ["No", "Yes — in this market", "Yes — in another municipal market"],
      helpText: "Most allotment rules restrict a second stall to the same family.",
    }),
    field("ms-f11", "identityProof", "Identity proof", "file", S4, { fileTypes: ["pdf", "jpg"], fileMaxMb: 5 }),
    field("ms-f12", "categoryCertificate", "Reservation category certificate", "file", S4, {
      fileTypes: ["pdf", "jpg"],
      fileMaxMb: 5,
      required: false,
      helpText: "Required only if you are claiming a reserved stall.",
    }),
  ];

  return formDesignFrom(fields, [
    { id: S1, label: "Stall" },
    { id: S2, label: "Applicant" },
    { id: S3, label: "Eligibility" },
    { id: S4, label: "Documents" },
  ], FORM_ID);
}

export function marketStallManifestBlocks() {
  const form = marketStallFormDesign();
  return {
    description:
      "Apply for allotment of a shop or stall in a municipal market. Allotment is decided by the " +
      "market committee. Monthly rent is billed separately once the stall is allotted.",
    slaDays: 45,
    formId: FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: FORM_ID }],
    workflowDefinitionId: WORKFLOW,
    feeScheduleId: FEE_SCHEDULE,
    feeModel: "slab" as const,
    hoaCode: "1604",
    issuanceType: "allotment_order",
    outputs: [
      { type: "allotment_order", templateKey: "ms-allotment-order", numberingFormat: "MKT/{ward}/{year}/{seq:5}" },
    ],
    requiredDocuments: [
      { docType: "id_proof", label: "Identity proof", mandatory: true, verifiedAtLane: "scrutiny" },
    ],
    laneBindings: [
      {
        key: "scrutiny",
        name: "Scrutiny",
        enabled: true,
        designationId: "market_inspector",
        designationLabel: "Market Inspector",
        slaDays: 15,
        escalationDesignationId: "market_superintendent",
        escalationDesignationLabel: "Market Superintendent",
      },
      {
        key: "committee",
        name: "Allotment committee",
        enabled: true,
        designationId: "market_committee",
        designationLabel: "Market Allotment Committee",
        slaDays: 20,
        escalationDesignationId: "municipal_commissioner",
        escalationDesignationLabel: "Municipal Commissioner",
      },
      {
        key: "allotment",
        name: "Allotment order",
        enabled: true,
        designationId: "market_superintendent",
        designationLabel: "Market Superintendent",
        slaDays: 10,
        escalationDesignationId: "municipal_commissioner",
        escalationDesignationLabel: "Municipal Commissioner",
      },
    ],
    feeFromMinor: rupees(1000),
    feeCurrency: "INR",
    channels: ["portal", "counter"],
    renewalPolicy: {
      renewable: true,
      renewalWindowDays: 60,
      validityMode: "duration" as const,
      validityYears: 3,
    },
    appealLinkage: {
      appealable: true,
      filingWindowDays: 30,
      appellateDesignationId: "municipal_commissioner",
      appellateDesignationLabel: "Municipal Commissioner",
      statutoryReference: "Municipal market allotment rules",
    },
  };
}

export function marketStallPackManifest() {
  return { businessService: "MKT", pilot: false, blocks: marketStallManifestBlocks() };
}
