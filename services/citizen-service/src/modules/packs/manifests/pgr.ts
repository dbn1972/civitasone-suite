/**
 * municipal-in-v1 / pack:pgr — Public Grievance Redressal (BRD §8.1.3).
 *
 * The BRD calls this the "wrap existing module" proof: the runtime backend stays
 * `citizen-service/grievance`; this pack supplies the 8-block wiring so the same
 * Designer that authors a certificate service can author a grievance one. That is
 * why the numbering, lanes and closure note are described here while none of the
 * grievance logic is duplicated.
 *
 * Grievance pattern specifics (designerConstants.hiddenBlocksForPattern):
 * B5 (Fee & Revenue) is hidden, so this pack deliberately carries NO feeModel,
 * NO feeScheduleId and NO hoaCode. assertDefinitionPublishable treats a
 * grievance with no fee model as non-fee-bearing and therefore does not demand
 * an HOA — a grievance that charged the citizen to complain would be the wrong
 * service in the first place.
 *
 * Output is a closure note rather than a certificate (FN-07 non-certificate
 * issuance type): nothing is granted, so nothing is certified.
 */

const PGR_FORM_ID = "cccccccc-0001-4000-8000-000000000201";
const PGR_WORKFLOW = "cccccccc-0003-4000-8000-000000000201";

const S1 = "pgr-sec-complaint";
const S2 = "pgr-sec-location";
const S3 = "pgr-sec-evidence";

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

export function pgrFormDesign() {
  const fields = [
    field("pgr-f1", "serviceCode", "Complaint category", "picklist_single", S1, {
      choices: [
        "Water supply",
        "Street light not working",
        "Garbage not collected",
        "Blocked drain / sewerage",
        "Damaged road",
        "Stray animals",
        // Added so the four commonest remaining complaint types route to the
        // right crew instead of falling into "Other", where they lose their
        // category-based auto-assignment and sit in a general queue.
        "Public toilet / sanitation",
        "Parks and trees",
        "Encroachment on road or footpath",
        "Unauthorised construction",
        "Bulk waste pickup",
        "Construction & demolition waste",
        "Dead animal removal",
        "Other",
      ],
      helpText: "Pick the closest category — it decides which team receives the complaint.",
    }),
    field("pgr-f2", "description", "What is the problem?", "textarea", S1, {
      helpText: "Describe what you have seen, and since when.",
    }),
    field("pgr-f3", "priority", "How urgent is it?", "picklist_single", S1, {
      choices: ["Routine", "Urgent", "Emergency"],
      helpText: "Emergency is for danger to life or property.",
      required: false,
    }),
    field("pgr-f4", "address", "Where is the problem?", "textarea", S2, {
      helpText: "A landmark helps the crew find it faster.",
    }),
    field("pgr-f5", "ward", "Ward", "ward", S2),
    field("pgr-f6", "complainantName", "Your name", "profile_name", S2),
    field("pgr-f7", "complainantMobile", "Mobile number", "profile_mobile", S2, {
      helpText: "Used to send you updates and the closure note.",
    }),
    field("pgr-f8", "photo", "Photo of the problem", "file", S3, {
      fileTypes: ["jpg", "png"],
      fileMaxMb: 5,
      required: false,
      helpText: "Optional, but a photo usually gets a complaint resolved sooner.",
    }),
  ];

  const fieldMap = Object.fromEntries(fields.map((f) => [f.id, f]));

  return {
    sections: [
      { id: S1, label: "Your complaint", fieldIds: fields.filter((f) => f.sectionId === S1).map((f) => f.id) },
      { id: S2, label: "Location and contact", fieldIds: fields.filter((f) => f.sectionId === S2).map((f) => f.id) },
      { id: S3, label: "Evidence", fieldIds: fields.filter((f) => f.sectionId === S3).map((f) => f.id) },
    ],
    fields: fieldMap,
    formId: PGR_FORM_ID,
  };
}

export function pgrManifestBlocks() {
  const form = pgrFormDesign();
  return {
    description:
      "Report a civic problem — water, street lights, garbage, drains, roads, parks, " +
      "sanitation, stray animals, encroachment or unauthorised construction. " +
      "There is no fee. You will be told who is handling it and when it is resolved.",
    slaDays: 7,
    formId: PGR_FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: PGR_FORM_ID }],
    // B3 eligibility is intentionally unwired: anyone may report a civic problem.
    workflowDefinitionId: PGR_WORKFLOW,
    // B5 hidden for this pattern — no feeModel, no feeScheduleId, no hoaCode.
    issuanceType: "closure_note",
    outputs: [
      { type: "closure_note", templateKey: "pgr-closure-note", numberingFormat: "PGR/{ward}/{year}/{seq:6}" },
    ],
    // No mandatory documents: requiring proof to report a broken street light
    // would suppress the reports the service exists to collect.
    requiredDocuments: [],
    /** FN-25 — auto-assignment by category + ward, then resolution. */
    laneBindings: [
      {
        key: "assignment",
        name: "Auto-assign",
        enabled: true,
        designationId: "grievance_officer",
        designationLabel: "Grievance Officer",
        slaDays: 1,
        escalationDesignationId: "ward_officer",
        escalationDesignationLabel: "Ward Officer",
      },
      {
        key: "resolution",
        name: "Resolution",
        enabled: true,
        designationId: "field_crew_supervisor",
        designationLabel: "Field Crew Supervisor",
        slaDays: 6,
        escalationDesignationId: "municipal_commissioner",
        escalationDesignationLabel: "Municipal Commissioner",
      },
    ],
    channels: ["portal", "counter", "mobile", "whatsapp"],
    /**
     * FN-27 — a rejected grievance can be escalated. The window is longer than
     * the certificate default because a citizen may not notice a rejection
     * immediately, having never had to track a decision date.
     */
    appealLinkage: {
      appealable: true,
      filingWindowDays: 45,
      appellateDesignationId: "municipal_commissioner",
      appellateDesignationLabel: "Municipal Commissioner",
      statutoryReference: "Grievance redressal policy — second appeal",
    },
  };
}

export function pgrPackManifest() {
  return {
    businessService: "PGR",
    pilot: true,
    /** Runtime stays citizen-service/grievance; this pack only supplies wiring. */
    wrapsExistingModule: "citizen-service/grievance",
    blocks: pgrManifestBlocks(),
  };
}
