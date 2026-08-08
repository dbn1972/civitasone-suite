/**
 * police-in-v1 / pack:event-permission — non-municipal Certificate/Permission manifest.
 *
 * BRD §8.3 (Police): "Event permission | Permission | — | full pack". Deliberately the
 * police service with NO Engine Binding: character certificate and tenant verification
 * both require the external `police.verification` adapter, which is declared
 * `available: false` in this environment (engine-bindings/domain.ts). Per the BRD §4.4
 * honesty rule a pack bound to an unavailable engine cannot pass FN-10 sandbox test, so
 * those two are not publishable here by design. Event permission needs only intake +
 * workflow + fee, so it publishes on the same 8-block wizard and proves the universality
 * claim across a second sector and a second pattern.
 */

const EP_FORM_ID = "cccccccc-0001-4000-8000-000000000201";
const EP_ELIGIBILITY = "cccccccc-0002-4000-8000-000000000201";
const EP_WORKFLOW = "cccccccc-0003-4000-8000-000000000201";
const EP_FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000201";

const S1 = "ep-sec-event";
const S2 = "ep-sec-organiser";
const S3 = "ep-sec-docs";

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

export function eventPermissionFormDesign() {
  const fields = [
    field("ep-f1", "eventName", "Event name", "text", S1),
    field("ep-f2", "eventType", "Event type", "picklist_single", S1, {
      choices: ["Public meeting", "Procession / rally", "Cultural programme", "Sports event", "Religious gathering"],
    }),
    field("ep-f3", "eventStartDate", "Start date", "date", S1),
    field("ep-f4", "eventEndDate", "End date", "date", S1),
    field("ep-f5", "venue", "Venue / route", "address", S1, {
      helpText: "For a procession, describe the full route",
    }),
    field("ep-f6", "expectedAttendance", "Expected attendance", "number", S1, {
      helpText: "Determines the security category and fee slab",
    }),
    field("ep-f7", "loudspeaker", "Loudspeaker / PA system", "picklist_single", S1, {
      choices: ["Yes", "No"],
      helpText: "Separate noise-rule conditions apply if yes",
    }),
    field("ep-f8", "organiserName", "Organiser name", "profile_name", S2),
    field("ep-f9", "organiserMobile", "Mobile number", "profile_mobile", S2),
    field("ep-f10", "organiserEmail", "Email", "profile_email", S2, { required: false }),
    field("ep-f11", "organisationName", "Organisation / body", "text", S2, { required: false }),
    field("ep-f12", "ward", "Police station / ward", "ward", S2),
    field("ep-f13", "idProof", "Organiser identity proof", "file", S3, { fileTypes: ["pdf", "jpg"], fileMaxMb: 5 }),
    field("ep-f14", "venueConsent", "Venue owner consent", "file", S3, { fileTypes: ["pdf"], fileMaxMb: 5 }),
    field("ep-f15", "routeMap", "Route map", "file", S3, {
      fileTypes: ["pdf", "jpg", "png"],
      fileMaxMb: 5,
      required: false,
      helpText: "Required for processions and rallies",
    }),
  ];

  const fieldMap = Object.fromEntries(fields.map((f) => [f.id, f]));

  return {
    sections: [
      { id: S1, label: "Event details", fieldIds: fields.filter((f) => f.sectionId === S1).map((f) => f.id) },
      { id: S2, label: "Organiser details", fieldIds: fields.filter((f) => f.sectionId === S2).map((f) => f.id) },
      { id: S3, label: "Documents", fieldIds: fields.filter((f) => f.sectionId === S3).map((f) => f.id) },
    ],
    fields: fieldMap,
    formId: EP_FORM_ID,
  };
}

/** Stable block wiring applied on pack import. */
export function eventPermissionManifestBlocks() {
  const form = eventPermissionFormDesign();
  return {
    description:
      "Apply for police permission to hold a public event, procession or gathering. " +
      "The station reviews the venue or route and issues a permission order with conditions.",
    slaDays: 10,
    formId: EP_FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: EP_FORM_ID }],
    eligibilityRuleSetId: EP_ELIGIBILITY,
    workflowDefinitionId: EP_WORKFLOW,
    feeScheduleId: EP_FEE_SCHEDULE,
    feeModel: "flat" as const,
    hoaCode: "1475",
    issuanceType: "certificate",
    outputs: [
      { type: "certificate", templateKey: "ep-permission-order", numberingFormat: "EP/{ward}/{year}/{seq:5}" },
    ],
    requiredDocuments: [
      { docType: "id_proof", label: "Organiser identity proof", mandatory: true, verifiedAtLane: "station_review" },
      { docType: "venue_consent", label: "Venue owner consent", mandatory: true, verifiedAtLane: "station_review" },
      { docType: "route_map", label: "Route map", mandatory: false, verifiedAtLane: "station_review" },
    ],
    /** FN-25 — station review then sanctioning officer decision. */
    laneBindings: [
      {
        key: "station_review",
        name: "Station review",
        enabled: true,
        designationId: "station_house_officer",
        designationLabel: "Station House Officer",
        slaDays: 5,
        escalationDesignationId: "circle_inspector",
        escalationDesignationLabel: "Circle Inspector",
      },
      {
        key: "decision",
        name: "Decision",
        enabled: true,
        designationId: "circle_inspector",
        designationLabel: "Circle Inspector",
        slaDays: 5,
        escalationDesignationId: "superintendent_of_police",
        escalationDesignationLabel: "Superintendent of Police",
      },
    ],
    feeFromMinor: 100000,
    feeCurrency: "INR",
    channels: ["portal", "counter"],
  };
}

export function eventPermissionPackManifest() {
  return {
    businessService: "EP",
    pilot: false,
    blocks: eventPermissionManifestBlocks(),
  };
}
