/**
 * pack:street-vendor — Certificate of Vending (Street Vendors Act, 2014).
 *
 * Two design points that matter more here than on a typical licence:
 *
 * 1. FEE IS ZERO AT APPLICATION. The Act entitles an identified vendor to a
 *    Certificate of Vending; charging to apply would put a barrier in front of
 *    the people the Act protects. Any recurring vending fee is a separate
 *    Collection service, not a gate on this one. The pack therefore declares a
 *    fee model and HOA (a certificate service is fee-bearing by pattern, and
 *    FN-14 needs somewhere to post) with a zero starting amount.
 *
 * 2. DOCUMENT REQUIREMENTS ARE DELIBERATELY LIGHT. Vendors frequently lack
 *    address proof; the Act contemplates survey-based identification rather than
 *    a documentary burden. Only identity is mandatory, and the survey reference
 *    is optional so a vendor not yet surveyed is not turned away at the form.
 */

import { field, formDesignFrom, rupees } from "./_shared.js";

const FORM_ID = "cccccccc-0001-4000-8000-000000000302";
const WORKFLOW = "cccccccc-0003-4000-8000-000000000302";
const FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000302";

const S1 = "sv-sec-vendor";
const S2 = "sv-sec-vending";
const S3 = "sv-sec-docs";

export function streetVendorFormDesign() {
  const fields = [
    field("sv-f1", "vendorName", "Your name", "profile_name", S1),
    field("sv-f2", "vendorMobile", "Mobile number", "profile_mobile", S1),
    field("sv-f3", "vendingSinceYear", "Vending at this place since (year)", "number", S1, {
      helpText: "Long-standing vendors have priority under the Act.",
    }),
    field("sv-f4", "surveyReference", "Town Vending Committee survey number", "text", S1, {
      required: false,
      helpText: "If you were counted in the vendor survey. Leave blank if you were not.",
    }),
    field("sv-f5", "vendingZone", "Vending zone", "picklist_single", S2, {
      choices: ["Designated vending zone", "Restricted vending zone", "Not yet zoned"],
    }),
    field("sv-f6", "ward", "Ward", "ward", S2),
    field("sv-f7", "vendingLocation", "Where do you vend?", "textarea", S2, {
      helpText: "Street name and a landmark.",
    }),
    field("sv-f8", "vendingType", "Type of vending", "picklist_single", S2, {
      choices: ["Stationary — cart", "Stationary — stall", "Stationary — mat / ground", "Mobile / itinerant"],
    }),
    field("sv-f9", "goodsSold", "What do you sell?", "text", S2),
    field("sv-f10", "identityProof", "Identity proof", "file", S3, {
      fileTypes: ["pdf", "jpg"],
      fileMaxMb: 5,
      helpText: "Aadhaar, voter ID, ration card or any government photo ID.",
    }),
    field("sv-f11", "vendorPhoto", "Your photograph", "file", S3, {
      fileTypes: ["jpg", "png"],
      fileMaxMb: 3,
      required: false,
      helpText: "Optional — the counter can take one for you.",
    }),
  ];

  return formDesignFrom(fields, [
    { id: S1, label: "About you" },
    { id: S2, label: "Where you vend" },
    { id: S3, label: "Documents" },
  ], FORM_ID);
}

export function streetVendorManifestBlocks() {
  const form = streetVendorFormDesign();
  return {
    description:
      "Apply for a Certificate of Vending. There is no application fee. If you were counted in " +
      "the vendor survey, bring your survey number — otherwise the Town Vending Committee will verify your case.",
    slaDays: 30,
    formId: FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: FORM_ID }],
    workflowDefinitionId: WORKFLOW,
    feeScheduleId: FEE_SCHEDULE,
    feeModel: "flat" as const,
    hoaCode: "4203",
    issuanceType: "certificate",
    outputs: [
      { type: "certificate", templateKey: "sv-vending-certificate", numberingFormat: "COV/{ward}/{year}/{seq:5}" },
    ],
    // Identity only. See the header: a documentary burden here defeats the Act.
    requiredDocuments: [
      { docType: "id_proof", label: "Identity proof", mandatory: true, verifiedAtLane: "tvc_verification" },
    ],
    laneBindings: [
      {
        key: "tvc_verification",
        name: "Town Vending Committee verification",
        enabled: true,
        designationId: "tvc_secretary",
        designationLabel: "Town Vending Committee Secretary",
        slaDays: 20,
        escalationDesignationId: "municipal_commissioner",
        escalationDesignationLabel: "Municipal Commissioner",
      },
      {
        key: "decision",
        name: "Issue certificate",
        enabled: true,
        designationId: "licensing_officer",
        designationLabel: "Licensing Officer",
        slaDays: 10,
        escalationDesignationId: "municipal_commissioner",
        escalationDesignationLabel: "Municipal Commissioner",
      },
    ],
    feeFromMinor: rupees(0),
    feeCurrency: "INR",
    channels: ["portal", "counter", "mobile", "assisted"],
    renewalPolicy: {
      renewable: true,
      renewalWindowDays: 60,
      validityMode: "duration" as const,
      validityYears: 3,
    },
    appealLinkage: {
      appealable: true,
      filingWindowDays: 30,
      appellateDesignationId: "vending_appellate_committee",
      appellateDesignationLabel: "Vending Appellate Committee",
      statutoryReference: "Street Vendors (Protection of Livelihood and Regulation of Street Vending) Act, 2014",
    },
  };
}

export function streetVendorPackManifest() {
  return { businessService: "SV", pilot: false, blocks: streetVendorManifestBlocks() };
}
