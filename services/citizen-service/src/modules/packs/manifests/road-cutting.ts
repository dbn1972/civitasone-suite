/**
 * pack:road-cutting — Road cutting / excavation permission.
 *
 * The whole point of this permission is that the road gets put back. So the pack
 * is built around restoration rather than around the dig:
 *
 *  - restoration charges are the fee basis (area × surface type), which is why
 *    length, width and surface are separate numeric fields;
 *  - a RESTORATION lane sits after the work, so the permission is not closed
 *    when the trench is dug but when the surface is reinstated and inspected;
 *  - validity is short and fixed rather than annual — a permission to dig should
 *    expire quickly, and an open-ended one invites a trench left for months.
 *
 * Not renewable by design: if the work overruns, the correct action is a fresh
 * permission with fresh restoration charges, not an extension that lets the
 * original deposit cover a longer disruption.
 */

import { field, formDesignFrom, rupees } from "./_shared.js";

const FORM_ID = "cccccccc-0001-4000-8000-000000000304";
const WORKFLOW = "cccccccc-0003-4000-8000-000000000304";
const FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000304";

const S1 = "rc-sec-location";
const S2 = "rc-sec-work";
const S3 = "rc-sec-applicant";
const S4 = "rc-sec-docs";

export function roadCuttingFormDesign() {
  const fields = [
    field("rc-f1", "roadName", "Road name", "text", S1),
    field("rc-f2", "ward", "Ward", "ward", S1),
    field("rc-f3", "startLandmark", "From (landmark)", "text", S1),
    field("rc-f4", "endLandmark", "To (landmark)", "text", S1),
    field("rc-f5", "surfaceType", "Road surface", "picklist_single", S1, {
      choices: ["Earthen", "WBM / gravel", "Bitumen", "Concrete", "Paver block", "Footpath"],
      helpText: "Restoration cost depends on the surface being cut.",
    }),
    field("rc-f6", "purpose", "Purpose of the excavation", "picklist_single", S2, {
      choices: ["Water connection", "Sewerage connection", "Electricity cable", "Telecom / OFC", "Gas pipeline", "Other utility"],
    }),
    field("rc-f7", "lengthM", "Length to be cut (metres)", "number", S2),
    field("rc-f8", "widthM", "Width to be cut (metres)", "number", S2, {
      helpText: "Length × width gives the area used to calculate restoration charges.",
    }),
    field("rc-f9", "depthM", "Depth (metres)", "number", S2),
    field("rc-f10", "proposedStartDate", "Proposed start date", "date", S2),
    field("rc-f11", "durationDays", "Expected duration (days)", "number", S2, {
      helpText: "Permission is valid for this period. Overrunning needs a fresh permission.",
    }),
    field("rc-f12", "trafficPlan", "How will traffic be managed?", "textarea", S2, {
      helpText: "Barricading, diversion and pedestrian access during the work.",
    }),
    field("rc-f13", "applicantName", "Applicant / agency name", "profile_name", S3),
    field("rc-f14", "applicantMobile", "Mobile number", "profile_mobile", S3),
    field("rc-f15", "siteSketch", "Site sketch or plan", "file", S4, { fileTypes: ["pdf", "jpg"], fileMaxMb: 10 }),
    field("rc-f16", "utilityApproval", "Approval from the utility concerned", "file", S4, {
      fileTypes: ["pdf"],
      fileMaxMb: 5,
      required: false,
      helpText: "If the work is on behalf of a utility company.",
    }),
  ];

  return formDesignFrom(fields, [
    { id: S1, label: "Location" },
    { id: S2, label: "Proposed work" },
    { id: S3, label: "Applicant" },
    { id: S4, label: "Documents" },
  ], FORM_ID);
}

export function roadCuttingManifestBlocks() {
  const form = roadCuttingFormDesign();
  return {
    description:
      "Apply for permission to cut or excavate a road. Restoration charges are payable up front " +
      "and are based on the area and surface type. The permission closes only after the road is restored and inspected.",
    slaDays: 12,
    formId: FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: FORM_ID }],
    workflowDefinitionId: WORKFLOW,
    feeScheduleId: FEE_SCHEDULE,
    feeModel: "slab" as const,
    hoaCode: "1452",
    issuanceType: "permission",
    outputs: [
      { type: "permission", templateKey: "rc-permission", numberingFormat: "RC/{ward}/{year}/{seq:5}" },
    ],
    requiredDocuments: [
      { docType: "site_sketch", label: "Site sketch or plan", mandatory: true, verifiedAtLane: "engineering_review" },
    ],
    laneBindings: [
      {
        key: "engineering_review",
        name: "Engineering review",
        enabled: true,
        designationId: "assistant_engineer_roads",
        designationLabel: "Assistant Engineer (Roads)",
        slaDays: 5,
        escalationDesignationId: "executive_engineer",
        escalationDesignationLabel: "Executive Engineer",
      },
      {
        key: "decision",
        name: "Permission",
        enabled: true,
        designationId: "executive_engineer",
        designationLabel: "Executive Engineer",
        slaDays: 3,
        escalationDesignationId: "city_engineer",
        escalationDesignationLabel: "City Engineer",
      },
      {
        key: "restoration",
        name: "Restoration inspection",
        enabled: true,
        designationId: "roads_inspector",
        designationLabel: "Roads Inspector",
        slaDays: 4,
        escalationDesignationId: "executive_engineer",
        escalationDesignationLabel: "Executive Engineer",
      },
    ],
    feeFromMinor: rupees(5000),
    feeCurrency: "INR",
    channels: ["portal", "counter"],
    // Deliberately not renewable — see the header.
    renewalPolicy: {
      renewable: false,
      renewalWindowDays: 0,
      validityMode: "duration" as const,
      validityYears: 1,
    },
    appealLinkage: {
      appealable: true,
      filingWindowDays: 15,
      appellateDesignationId: "city_engineer",
      appellateDesignationLabel: "City Engineer",
    },
  };
}

export function roadCuttingPackManifest() {
  return { businessService: "RC", pilot: false, blocks: roadCuttingManifestBlocks() };
}
