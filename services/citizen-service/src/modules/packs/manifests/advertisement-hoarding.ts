/**
 * pack:advertisement-hoarding — Advertisement / hoarding permission.
 *
 * Fee is a slab on area × duration × location class, which is why all three are
 * captured as structured fields rather than free text: an inspector should not
 * have to read a paragraph to work out what is owed, and the slab schedule
 * cannot key off prose.
 *
 * Structural safety is a real lane, not a formality. A hoarding that falls kills
 * people, so the structural stability certificate is mandatory and verified
 * before the decision rather than filed afterwards.
 */

import { field, formDesignFrom, rupees } from "./_shared.js";

const FORM_ID = "cccccccc-0001-4000-8000-000000000303";
const WORKFLOW = "cccccccc-0003-4000-8000-000000000303";
const FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000303";

const S1 = "ad-sec-site";
const S2 = "ad-sec-display";
const S3 = "ad-sec-applicant";
const S4 = "ad-sec-docs";

export function advertisementFormDesign() {
  const fields = [
    field("ad-f1", "siteAddress", "Site address", "textarea", S1),
    field("ad-f2", "ward", "Ward", "ward", S1),
    field("ad-f3", "locationClass", "Location class", "picklist_single", S1, {
      choices: ["Arterial road", "Sub-arterial road", "Local street", "Private premises"],
      helpText: "Rates differ by road class.",
    }),
    field("ad-f4", "structureType", "Type of structure", "picklist_single", S1, {
      choices: ["Ground-based hoarding", "Wall-mounted", "Rooftop", "Pole kiosk", "Digital / LED display"],
    }),
    field("ad-f5", "displayWidthM", "Width (metres)", "number", S2),
    field("ad-f6", "displayHeightM", "Height (metres)", "number", S2, {
      helpText: "Width and height together give the area used for the fee slab.",
    }),
    field("ad-f7", "illuminated", "Is it illuminated?", "picklist_single", S2, {
      choices: ["Not illuminated", "Back-lit", "Front-lit", "Digital / LED"],
    }),
    field("ad-f8", "displayFrom", "Display from", "date", S2),
    field("ad-f9", "displayTo", "Display until", "date", S2, {
      helpText: "Duration is charged in months; part months are charged in full.",
    }),
    field("ad-f10", "contentDescription", "What will be displayed?", "textarea", S2, {
      helpText: "Content must not be political, tobacco or alcohol related.",
    }),
    field("ad-f11", "applicantName", "Applicant / agency name", "profile_name", S3),
    field("ad-f12", "applicantMobile", "Mobile number", "profile_mobile", S3),
    field("ad-f13", "gstin", "GSTIN", "text", S3, { required: false }),
    field("ad-f14", "sitePhotograph", "Photograph of the site", "file", S4, { fileTypes: ["jpg", "png"], fileMaxMb: 5 }),
    field("ad-f15", "structuralCertificate", "Structural stability certificate", "file", S4, {
      fileTypes: ["pdf"],
      fileMaxMb: 10,
      helpText: "From a registered structural engineer. Required for all ground-based and rooftop structures.",
    }),
    field("ad-f16", "ownerConsent", "Consent of the site owner", "file", S4, { fileTypes: ["pdf", "jpg"], fileMaxMb: 5 }),
  ];

  return formDesignFrom(fields, [
    { id: S1, label: "Site" },
    { id: S2, label: "Display" },
    { id: S3, label: "Applicant" },
    { id: S4, label: "Documents" },
  ], FORM_ID);
}

export function advertisementManifestBlocks() {
  const form = advertisementFormDesign();
  return {
    description:
      "Apply for permission to display an advertisement or hoarding. The fee depends on size, " +
      "duration, illumination and road class. A structural stability certificate is required.",
    slaDays: 15,
    formId: FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: FORM_ID }],
    workflowDefinitionId: WORKFLOW,
    feeScheduleId: FEE_SCHEDULE,
    feeModel: "slab" as const,
    hoaCode: "1451",
    issuanceType: "permission",
    outputs: [
      { type: "permission", templateKey: "ad-permission", numberingFormat: "ADV/{ward}/{year}/{seq:5}" },
    ],
    requiredDocuments: [
      { docType: "site_photograph", label: "Photograph of the site", mandatory: true, verifiedAtLane: "site_scrutiny" },
      { docType: "structural_certificate", label: "Structural stability certificate", mandatory: true, verifiedAtLane: "structural_review" },
      { docType: "owner_consent", label: "Consent of the site owner", mandatory: true, verifiedAtLane: "site_scrutiny" },
    ],
    laneBindings: [
      {
        key: "site_scrutiny",
        name: "Site scrutiny",
        enabled: true,
        designationId: "advertisement_inspector",
        designationLabel: "Advertisement Inspector",
        slaDays: 6,
        escalationDesignationId: "advertisement_officer",
        escalationDesignationLabel: "Advertisement Officer",
      },
      {
        key: "structural_review",
        name: "Structural review",
        enabled: true,
        designationId: "city_engineer",
        designationLabel: "City Engineer",
        slaDays: 5,
        escalationDesignationId: "executive_engineer",
        escalationDesignationLabel: "Executive Engineer",
      },
      {
        key: "decision",
        name: "Decision",
        enabled: true,
        designationId: "advertisement_officer",
        designationLabel: "Advertisement Officer",
        slaDays: 4,
        escalationDesignationId: "municipal_commissioner",
        escalationDesignationLabel: "Municipal Commissioner",
      },
    ],
    feeFromMinor: rupees(2000),
    feeCurrency: "INR",
    channels: ["portal", "counter"],
    renewalPolicy: {
      renewable: true,
      renewalWindowDays: 30,
      validityMode: "duration" as const,
      validityYears: 1,
    },
    appealLinkage: {
      appealable: true,
      filingWindowDays: 30,
      appellateDesignationId: "municipal_commissioner",
      appellateDesignationLabel: "Municipal Commissioner",
    },
  };
}

export function advertisementPackManifest() {
  return { businessService: "ADV", pilot: false, blocks: advertisementManifestBlocks() };
}
