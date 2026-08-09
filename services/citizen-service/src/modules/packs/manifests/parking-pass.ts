/**
 * pack:parking-pass — Residential / monthly parking pass.
 *
 * SCOPE, stated plainly: this is a PASS, not a live parking-space booking. It
 * sells the right to park in a zone for a period. Real-time bay availability
 * needs occupancy sensing or ANPR — an engine this platform does not have — and
 * a pack that implied "book bay 14 for 3pm" would promise something no backend
 * can honour. Whoever adds live bay booking later should add an engine binding
 * for it rather than extending this pack.
 *
 * The vehicle number is the identity of the pass, so it is captured in a
 * normalised, checkable form and the pass number carries the zone.
 */

import { field, formDesignFrom, rupees } from "./_shared.js";

const FORM_ID = "cccccccc-0001-4000-8000-000000000306";
const WORKFLOW = "cccccccc-0003-4000-8000-000000000306";
const FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000306";

const S1 = "pk-sec-pass";
const S2 = "pk-sec-vehicle";
const S3 = "pk-sec-applicant";
const S4 = "pk-sec-docs";

export function parkingPassFormDesign() {
  const fields = [
    field("pk-f1", "passType", "Type of pass", "picklist_single", S1, {
      choices: ["Resident monthly", "Resident annual", "Commercial monthly", "Two-wheeler monthly"],
    }),
    field("pk-f2", "parkingZone", "Parking zone", "picklist_single", S1, {
      choices: ["Zone A — commercial core", "Zone B — market", "Zone C — residential", "Zone D — transport hub"],
      helpText: "Rates differ by zone. A pass is valid only in the zone it is issued for.",
    }),
    field("pk-f3", "ward", "Ward", "ward", S1),
    field("pk-f4", "validFrom", "Valid from", "date", S1),
    field("pk-f5", "vehicleNumber", "Vehicle registration number", "text", S2, {
      helpText: "As on the RC book, without spaces — for example OD02AB1234.",
      pattern: "^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$",
    }),
    field("pk-f6", "vehicleType", "Vehicle type", "picklist_single", S2, {
      choices: ["Two-wheeler", "Car / LMV", "Auto-rickshaw", "Light commercial vehicle"],
    }),
    field("pk-f7", "vehicleMakeModel", "Make and model", "text", S2, { required: false }),
    field("pk-f8", "applicantName", "Applicant name", "profile_name", S3),
    field("pk-f9", "applicantMobile", "Mobile number", "profile_mobile", S3),
    field("pk-f10", "residenceAddress", "Address", "textarea", S3, {
      helpText: "A resident pass is issued only for an address inside the zone.",
    }),
    field("pk-f11", "registrationCertificate", "Vehicle registration certificate", "file", S4, {
      fileTypes: ["pdf", "jpg"],
      fileMaxMb: 5,
    }),
    field("pk-f12", "addressProof", "Address proof", "file", S4, {
      fileTypes: ["pdf", "jpg"],
      fileMaxMb: 5,
      helpText: "Required for a resident pass.",
    }),
  ];

  return formDesignFrom(fields, [
    { id: S1, label: "Pass" },
    { id: S2, label: "Vehicle" },
    { id: S3, label: "Applicant" },
    { id: S4, label: "Documents" },
  ], FORM_ID);
}

export function parkingPassManifestBlocks() {
  const form = parkingPassFormDesign();
  return {
    description:
      "Apply for a monthly or annual parking pass for a municipal parking zone. The pass is valid " +
      "only in the zone it is issued for and is tied to one vehicle.",
    slaDays: 3,
    formId: FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: FORM_ID }],
    workflowDefinitionId: WORKFLOW,
    feeScheduleId: FEE_SCHEDULE,
    feeModel: "slab" as const,
    hoaCode: "1603",
    issuanceType: "confirmation",
    outputs: [
      { type: "confirmation", templateKey: "pk-parking-pass", numberingFormat: "PKG/{ward}/{year}/{seq:5}" },
    ],
    requiredDocuments: [
      { docType: "vehicle_rc", label: "Vehicle registration certificate", mandatory: true, verifiedAtLane: "verification" },
      { docType: "address_proof", label: "Address proof", mandatory: true, verifiedAtLane: "verification" },
    ],
    laneBindings: [
      {
        key: "verification",
        name: "Verification",
        enabled: true,
        designationId: "parking_clerk",
        designationLabel: "Parking Clerk",
        slaDays: 2,
        escalationDesignationId: "parking_officer",
        escalationDesignationLabel: "Parking Officer",
      },
      {
        key: "issue",
        name: "Issue pass",
        enabled: true,
        designationId: "parking_officer",
        designationLabel: "Parking Officer",
        slaDays: 1,
        escalationDesignationId: "municipal_commissioner",
        escalationDesignationLabel: "Municipal Commissioner",
      },
    ],
    feeFromMinor: rupees(300),
    feeCurrency: "INR",
    channels: ["portal", "counter", "mobile"],
    renewalPolicy: {
      renewable: true,
      renewalWindowDays: 15,
      validityMode: "duration" as const,
      validityYears: 1,
    },
  };
}

export function parkingPassPackManifest() {
  return { businessService: "PKG", pilot: false, blocks: parkingPassManifestBlocks() };
}
