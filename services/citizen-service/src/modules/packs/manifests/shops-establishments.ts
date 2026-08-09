/**
 * pack:shops-establishments — Shops & Establishments registration.
 *
 * Registration under the state Shops and Establishments Act. The employee count
 * drives both the fee slab and, in most states, the renewal cycle, so it is
 * asked once and used for both rather than being re-derived later.
 *
 * Renewable, because the registration lapses; FN-15 is wired so the runtime
 * opens the window rather than leaving the shopkeeper to discover an expired
 * certificate during an inspection.
 */

import { field, formDesignFrom, rupees } from "./_shared.js";

const FORM_ID = "cccccccc-0001-4000-8000-000000000301";
const WORKFLOW = "cccccccc-0003-4000-8000-000000000301";
const FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000301";

const S1 = "se-sec-establishment";
const S2 = "se-sec-employment";
const S3 = "se-sec-employer";
const S4 = "se-sec-docs";

export function shopsEstablishmentsFormDesign() {
  const fields = [
    field("se-f1", "establishmentName", "Name of the establishment", "text", S1),
    field("se-f2", "establishmentAddress", "Address", "textarea", S1),
    field("se-f3", "ward", "Ward", "ward", S1),
    field("se-f4", "natureOfBusiness", "Nature of business", "picklist_single", S1, {
      choices: ["Shop", "Commercial establishment", "Restaurant / eating house", "Residential hotel", "Theatre / place of public amusement"],
      helpText: "The Act treats these categories differently, so pick the closest.",
    }),
    field("se-f5", "commencementDate", "Date business started", "date", S1, {
      helpText: "Registration is due within 30 days of starting.",
    }),
    field("se-f6", "totalEmployees", "Total number of employees", "number", S2, {
      helpText: "Including family members working in the business. This decides the fee.",
    }),
    field("se-f7", "womenEmployees", "Of whom, women employees", "number", S2, {
      required: false,
      helpText: "Establishments employing women after 7pm have additional obligations.",
    }),
    field("se-f8", "weeklyHoliday", "Weekly closing day", "picklist_single", S2, {
      choices: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    }),
    field("se-f9", "employerName", "Employer name", "profile_name", S3),
    field("se-f10", "employerMobile", "Mobile number", "profile_mobile", S3),
    field("se-f11", "employerEmail", "Email", "profile_email", S3, { required: false }),
    field("se-f12", "premisesProof", "Proof of premises", "file", S4, {
      fileTypes: ["pdf", "jpg"],
      fileMaxMb: 5,
      helpText: "Rent agreement, ownership document or electricity bill.",
    }),
    field("se-f13", "identityProof", "Employer identity proof", "file", S4, { fileTypes: ["pdf", "jpg"], fileMaxMb: 5 }),
  ];

  return formDesignFrom(fields, [
    { id: S1, label: "Establishment" },
    { id: S2, label: "Employment" },
    { id: S3, label: "Employer" },
    { id: S4, label: "Documents" },
  ], FORM_ID);
}

export function shopsEstablishmentsManifestBlocks() {
  const form = shopsEstablishmentsFormDesign();
  return {
    description:
      "Register your shop or commercial establishment. Registration is required within 30 days " +
      "of starting business and must be renewed before it expires.",
    slaDays: 10,
    formId: FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: FORM_ID }],
    workflowDefinitionId: WORKFLOW,
    feeScheduleId: FEE_SCHEDULE,
    // Slab by employee count — the standard basis under the Act.
    feeModel: "slab" as const,
    hoaCode: "4202",
    issuanceType: "certificate",
    outputs: [
      { type: "certificate", templateKey: "se-registration-certificate", numberingFormat: "SE/{ward}/{year}/{seq:5}" },
    ],
    requiredDocuments: [
      { docType: "premises_proof", label: "Proof of premises", mandatory: true, verifiedAtLane: "scrutiny" },
      { docType: "id_proof", label: "Employer identity proof", mandatory: true, verifiedAtLane: "scrutiny" },
    ],
    laneBindings: [
      {
        key: "scrutiny",
        name: "Scrutiny",
        enabled: true,
        designationId: "labour_inspector",
        designationLabel: "Labour Inspector",
        slaDays: 6,
        escalationDesignationId: "licensing_officer",
        escalationDesignationLabel: "Licensing Officer",
      },
      {
        key: "decision",
        name: "Decision",
        enabled: true,
        designationId: "licensing_officer",
        designationLabel: "Licensing Officer",
        slaDays: 4,
        escalationDesignationId: "municipal_commissioner",
        escalationDesignationLabel: "Municipal Commissioner",
      },
    ],
    feeFromMinor: rupees(500),
    feeCurrency: "INR",
    channels: ["portal", "counter", "mobile"],
    renewalPolicy: {
      renewable: true,
      renewalWindowDays: 45,
      validityMode: "duration" as const,
      validityYears: 5,
    },
    appealLinkage: {
      appealable: true,
      filingWindowDays: 30,
      appellateDesignationId: "municipal_commissioner",
      appellateDesignationLabel: "Municipal Commissioner",
      statutoryReference: "Shops and Establishments Act — appeal against refusal",
    },
  };
}

export function shopsEstablishmentsPackManifest() {
  return { businessService: "SE", pilot: false, blocks: shopsEstablishmentsManifestBlocks() };
}
