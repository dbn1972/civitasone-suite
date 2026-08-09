/**
 * pack:general-noc — Generic municipal NOC / certificate.
 *
 * The starting point for the long tail: the dozens of small NOCs and
 * certificates a municipality issues that do not each justify a bespoke pack —
 * no-dues certificates, tree-cutting permission, temporary structure permission,
 * loudspeaker permission, and so on.
 *
 * DESIGNED TO BE EDITED, NOT USED AS-IS. A designer imports it, renames it,
 * narrows the NOC-type picklist to the one thing it now issues, and adjusts the
 * documents and lanes. Everything here is therefore the most defensible default
 * rather than a guess at a particular NOC:
 *
 *  - two lanes (verify, decide), the minimum that still separates the person who
 *    checks from the person who decides;
 *  - one mandatory document — identity — because every NOC needs to know who is
 *    asking and nothing else is universal;
 *  - a free-text purpose field, since the whole point is that the purpose varies;
 *  - a nominal fee, which a designer will almost always change.
 *
 * If a municipality finds itself keeping several near-identical copies of this,
 * that is the signal to promote it to a real pack with its own fields.
 */

import { field, formDesignFrom, rupees } from "./_shared.js";

const FORM_ID = "cccccccc-0001-4000-8000-000000000309";
const WORKFLOW = "cccccccc-0003-4000-8000-000000000309";
const FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000309";

const S1 = "noc-sec-request";
const S2 = "noc-sec-applicant";
const S3 = "noc-sec-docs";

export function generalNocFormDesign() {
  const fields = [
    field("noc-f1", "nocType", "What do you need?", "picklist_single", S1, {
      choices: [
        "No-dues certificate",
        "Tree cutting or pruning permission",
        "Temporary structure / pandal permission",
        "Loudspeaker permission",
        "Occupancy / usage NOC",
        "Other municipal NOC",
      ],
      helpText: "Narrow this list when you adapt this service to a single NOC.",
    }),
    field("noc-f2", "purpose", "Why do you need it?", "textarea", S1, {
      helpText: "Explain briefly — this is what the officer reads first.",
    }),
    field("noc-f3", "premisesAddress", "Address the NOC relates to", "textarea", S1),
    field("noc-f4", "ward", "Ward", "ward", S1),
    field("noc-f5", "requiredBy", "Needed by", "date", S1, {
      required: false,
      helpText: "If there is a deadline. We cannot always meet it, but the office will know.",
    }),
    field("noc-f6", "applicantName", "Applicant name", "profile_name", S2),
    field("noc-f7", "applicantMobile", "Mobile number", "profile_mobile", S2),
    field("noc-f8", "applicantEmail", "Email", "profile_email", S2, { required: false }),
    field("noc-f9", "identityProof", "Identity proof", "file", S3, { fileTypes: ["pdf", "jpg"], fileMaxMb: 5 }),
    field("noc-f10", "supportingDocument", "Supporting document", "file", S3, {
      fileTypes: ["pdf", "jpg"],
      fileMaxMb: 10,
      required: false,
      helpText: "Anything that supports your request — make this mandatory when you adapt the service.",
    }),
  ];

  return formDesignFrom(fields, [
    { id: S1, label: "Your request" },
    { id: S2, label: "Applicant" },
    { id: S3, label: "Documents" },
  ], FORM_ID);
}

export function generalNocManifestBlocks() {
  const form = generalNocFormDesign();
  return {
    description:
      "Apply for a municipal no-objection certificate or permission. Tell us what you need and why, " +
      "and the concerned department will verify and issue it.",
    slaDays: 15,
    formId: FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: FORM_ID }],
    workflowDefinitionId: WORKFLOW,
    feeScheduleId: FEE_SCHEDULE,
    feeModel: "flat" as const,
    hoaCode: "4209",
    issuanceType: "certificate",
    outputs: [
      { type: "certificate", templateKey: "noc-certificate", numberingFormat: "NOC/{ward}/{year}/{seq:5}" },
    ],
    requiredDocuments: [
      { docType: "id_proof", label: "Identity proof", mandatory: true, verifiedAtLane: "verification" },
    ],
    laneBindings: [
      {
        key: "verification",
        name: "Verification",
        enabled: true,
        designationId: "dealing_assistant",
        designationLabel: "Dealing Assistant",
        slaDays: 9,
        escalationDesignationId: "section_officer",
        escalationDesignationLabel: "Section Officer",
      },
      {
        key: "decision",
        name: "Decision",
        enabled: true,
        designationId: "section_officer",
        designationLabel: "Section Officer",
        slaDays: 6,
        escalationDesignationId: "municipal_commissioner",
        escalationDesignationLabel: "Municipal Commissioner",
      },
    ],
    feeFromMinor: rupees(100),
    feeCurrency: "INR",
    channels: ["portal", "counter", "mobile"],
    appealLinkage: {
      appealable: true,
      filingWindowDays: 30,
      appellateDesignationId: "municipal_commissioner",
      appellateDesignationLabel: "Municipal Commissioner",
    },
  };
}

export function generalNocPackManifest() {
  return {
    businessService: "NOC",
    pilot: false,
    /** Signals to onboarding that this is a starting point, not a finished service. */
    template: true,
    blocks: generalNocManifestBlocks(),
  };
}
